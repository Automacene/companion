/**
 * Companion's assemble hook: gathered pools in, Ollama chat messages out.
 *
 * The library's default flattens everything into one string, which would put
 * the system prompt inside a user turn. This keeps the roles, so history
 * arrives as real user/assistant pairs.
 *
 * Recalled material is counted here even though pools are not, because recall
 * is bounded by a count of items and a count says nothing about size. The two
 * ranked pools share one token budget, spent in score order.
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
  /** Whatever was attached to the current turn - for companion, a page read. */
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
 * no way to carry one - it hands over pools, not preferences. Closing over it
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

  // Recalled material, from both ranked pools, sharing one token budget.
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
    // Always keep the first, whatever it costs.
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

  // The page open in this tab, as standing context rather than as something the user just said.
  const open = sources.context?.entries?.[0]?.node?.content as
    { title?: string; url?: string; content?: string } | undefined;

  if (open?.content) {
    const where = [open.title, open.url].filter(Boolean).join(' - ');
    system.push(
      `# The page open in this tab
${where}

${open.content}

` +
        'This is what the user is looking at now. It stays open across questions, ' +
        'so treat it as something already read rather than as newly handed over.',
    );
  }

  const messages: ModelMessage[] = [];
  if (system.length > 0) messages.push({ role: 'system', content: system.join('\n\n') });

  // The window, as real turns.
  for (const entry of sources.window?.entries ?? []) {
    const record = parseNode(entry.node) as any;
    // The window pool holds turns only.
    if (!record || record.kind !== 'turn') continue;

    if (record.query) {
      // History gets the question and a note of which page was open, never the page itself.
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

  // Just the question. Whatever it is about is already above it.
  messages.push({ role: 'user', content: String(query) });

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
