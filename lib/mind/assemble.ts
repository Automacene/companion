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
 *   system text + tools + archive  -> one `system` message
 *   window (closed turns)          -> alternating `user` / `assistant`
 *   the current query + context    -> the final `user` message
 *
 * Thinking and action pools are not assembled — in the mind they carry
 * `context: null`, so `gather()` never hands them over. They exist for the
 * turn record and the archive, not for the prompt.
 *
 * No token counting happens here. Eviction policies bound every pool before
 * assembly runs, so whatever arrives is already within budget; counting again
 * would be the same work twice and a second place for the numbers to disagree.
 */
import { formatRecord, formatToolOption, parseNode } from '@automacene/conversation';
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

export function assembleChat(gathered: Gathered): ModelMessage[] {
  const { sources, query, context } = gathered;

  const system: string[] = [];

  const base = systemTextOf(gathered.mind);
  if (base) system.push(base);

  // Tools, under their masked ids. The same offer object is what
  // `readToolCall` resolves against, so the ids the model sees are the only
  // ids that parse.
  const offer = sources.tools?.offer;
  if (offer && offer.options.length > 0) {
    system.push(
      '# Tools available to you\n' +
        offer.options.map((option) => formatToolOption(option)).join('\n') +
        `\nTo use one, reply with its id and arguments. To answer without a tool, ignore them. [${offer.none}] declines explicitly.`
    );
  }

  // Recalled memory. `mode: "archive"` renders a turn as asked/answered pairs
  // rather than as a transcript, which reads as reference material.
  const archive = sources.archive?.entries ?? [];
  if (archive.length > 0) {
    system.push(
      '# Recalled from earlier browsing\n' +
        archive
          .map((entry) => formatRecord(parseNode(entry.node), { mode: 'archive' }))
          .filter(Boolean)
          .join('\n')
    );
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
        History gets the question ONLY, never the page that was attached to it.

        Merging it back in was the bug the whole design is meant to avoid: a
        600,000-character page read would return in full on every subsequent
        turn, growing the prompt without bound and putting the same text in the
        window that the archive already holds. A one-line marker keeps the fact
        that a page was attached without keeping the page.
      */
      const marker = pageMarkerFor(record.context);
      messages.push({ role: 'user', content: marker ? `${marker}\n${record.query}` : record.query });
    }
    if (record.response) {
      messages.push({ role: 'assistant', content: String(record.response) });
    }
  }

  messages.push({ role: 'user', content: withContext(query, context) });

  return messages;
}

/**
 * A one-line note that a page was attached, for a turn already in history.
 *
 * The page itself is not repeated — it was in the prompt on the turn it
 * arrived, and it is in the archive now if it mattered.
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
