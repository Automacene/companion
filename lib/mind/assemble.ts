/**
 * Companion's assemble hook: gathered pools in, Ollama chat messages out.
 *
 * The library's default assembler flattens everything into one string, which
 * would put the system prompt inside a user turn — Ollama's chat template
 * gives the system role a privileged position, and text arriving as `user`
 * does not get it. This assembler keeps the roles.
 *
 * How the pools map:
 *
 *   system text + scraped + archive -> one `system` message
 *   window (closed turns)           -> alternating `user` / `assistant`
 *   context pool + the query        -> the final `user` message
 *
 * `thread` is not assembled — it carries `context: null` in the mind, so
 * `gather()` never hands it over. It exists for the panel's scrollback.
 *
 * Recalled material IS counted here, unlike the pools. Eviction bounds what a
 * pool holds, but recall is bounded by a count of items, and a count says
 * nothing about size: eight fragments of six hundred characters and eight of
 * six thousand are the same number and very different prompts. `archiveShare`
 * is the token budget for the two ranked pools together, and it is spent in
 * score order so the best matches survive the cut.
 */
import { formatRecord, parseNode } from '@automacene/conversation';
import type { ModelMessage } from 'ai';

/** One pool's worth of gathered material, as `gather()` builds it. */
interface GatheredSource {
  mode: 'whole' | 'ranked';
  entries?: { node: any; score?: number }[];
  offer?: {
    options: { id: string; tool: any; choices: Record<string, { id: string; value: string }[]> }[];
    none: string;
  };
}

/** What `scope.gather()` returns. Typed here because the library ships JSDoc. */
export interface Gathered {
  query: string;
  turnId: string | null;
  /** Whatever was attached to the current turn — for companion, a page read. */
  context: unknown;
  scope: string | null;
  mind: { assemble?: { template?: string }; pools: Record<string, unknown> };
  sources: Record<string, GatheredSource>;
  estimateTokens: (text: string) => number;
  /** Set by `makeAssembler`, not by `gather()`. See the note there. */
  recallTokenBudget?: number;
}

/**
 * The system text comes from the mind's template. Everything above the first
 * placeholder is the instruction block; companion's mind keeps its whole
 * system prompt there, so this takes the text before `{` and nothing else.
 */
function systemTextOf(mind: Gathered['mind']): string {
  const template = mind.assemble?.template ?? '';
  const cut = template.indexOf('{');
  return (cut === -1 ? template : template.slice(0, cut)).trim();
}

/**
 * Build the assemble hook with the recall budget baked in.
 *
 * The budget is a companion setting derived from `num_ctx`, and `gather()` has
 * no way to carry one — it hands over pools, not preferences. Closing over it
 * here is the same arrangement the eviction hooks use: the mind names a hook,
 * and the hook is where the number lives.
 */
export function makeAssembler(recallTokenBudget: number) {
  return function assemble(gathered: Gathered): ModelMessage[] {
    return assembleChat({ ...gathered, recallTokenBudget });
  };
}

export function assembleChat(gathered: Gathered): ModelMessage[] {
  const { sources, query } = gathered;

  const system: string[] = [];

  const base = systemTextOf(gathered.mind);
  if (base) system.push(base);

  /*
    Recalled material, from both ranked pools, sharing one token budget.

    Spent in score order across the two rather than a fixed slice each, so a
    question that is really about a page is answered mostly with page
    fragments and one about an earlier conversation mostly with turns. Giving
    each pool a guaranteed share would waste it whenever a question is
    lopsided, which most questions are.
  */
  const recalled = [
    ...(sources.scraped?.entries ?? []).map((entry) => ({ entry, from: 'scraped' as const })),
    ...(sources.archive?.entries ?? []).map((entry) => ({ entry, from: 'archive' as const })),
  ].sort((a, b) => (b.entry.score ?? 0) - (a.entry.score ?? 0));

  const fromPages: string[] = [];
  const fromTalk: string[] = [];

  let spent = 0;
  const budget = gathered.recallTokenBudget ?? Infinity;

  for (const { entry, from } of recalled) {
    const text = formatRecord(parseNode(entry.node), { mode: 'archive' });
    if (!text) continue;

    const cost = gathered.estimateTokens(text);
    // Always keep the first, whatever it costs. A budget too small to hold one
    // memory should degrade to one memory, not to silently none.
    if (spent + cost > budget && fromPages.length + fromTalk.length > 0) break;

    spent += cost;
    (from === 'scraped' ? fromPages : fromTalk).push(text);
  }

  if (fromPages.length > 0) {
    system.push('# From pages you have read\n' + fromPages.join('\n\n'));
  }

  if (fromTalk.length > 0) {
    system.push('# Recalled from earlier browsing\n' + fromTalk.join('\n'));
  }

  const messages: ModelMessage[] = [];
  if (system.length > 0) messages.push({ role: 'system', content: system.join('\n\n') });

  // The window, as real turns. This is the part a string assembler cannot do:
  // each closed turn becomes a genuine user/assistant pair, so the model's
  // chat template treats history as history.
  for (const entry of sources.window?.entries ?? []) {
    const record = parseNode(entry.node) as any;
    // The window pool holds turns only, but parseNode's return type is the
    // union of every registered kind, so narrow by the field we need.
    if (!record || record.kind !== 'turn') continue;

    if (record.query) {
      /*
        History gets the question and a note of which page was open, never the
        page itself. Replaying a twelve-thousand character page on every
        subsequent turn grows the prompt without bound.

        The turn only ever holds the title and address now — the text lives in
        the context pool while it is current and in `scraped` afterwards — so
        there is nothing here to accidentally repeat.
      */
      const marker = pageMarkerFor(record.context);
      messages.push({
        role: 'user',
        content: marker ? `${marker}\n${record.query}` : record.query,
      });
    }
    if (record.response) {
      messages.push({ role: 'assistant', content: String(record.response) });
    }
  }

  /*
    The page currently open in this tab, sent in full with the question.

    It comes from the context pool rather than from the turn, which is what
    makes it reachable at all. As a turn field it could only ever appear on the
    turn that created it: history has to suppress it, so the page went dark the
    moment the next question was asked. Held in a pool it stays attached until
    another page replaces it, which is what somebody means by "the page I am
    looking at".
  */
  const open = sources.context?.entries?.[0]?.node?.content;
  messages.push({ role: 'user', content: withContext(query, open) });

  return messages;
}

/**
 * A one-line note of which page was open when a past question was asked.
 *
 * The turn stores only the title and address, so this is the whole of what it
 * has. The text itself is in `scraped` and comes back through recall if it is
 * relevant, in the piece that matched rather than in full.
 */
function pageMarkerFor(context: unknown): string {
  if (context == null) return '';

  const page = context as { title?: string; url?: string };
  if (typeof page === 'object' && (page.title || page.url)) {
    return `[read the page: ${page.title ?? page.url}]`;
  }

  return '[context was attached]';
}

/**
 * Attach page context to the message it belongs to.
 *
 * The old system spliced the page into the stored message text, which is why
 * scraped pages reappeared in the visible history when switching tabs. Here
 * the turn stores `context` as its own field and it is only merged at
 * assembly, so the stored conversation stays clean.
 */
function withContext(query: string, context: unknown): string {
  if (context == null) return String(query);

  const page = context as { title?: string; url?: string; content?: string };
  if (typeof page === 'object' && page.content) {
    return (
      `[Attached page: ${page.title ?? 'Untitled'}${page.url ? ` — ${page.url}` : ''}]\n` +
      `${page.content}\n\n${query}`
    );
  }

  return `[Attached context]\n${typeof context === 'string' ? context : JSON.stringify(context)}\n\n${query}`;
}
