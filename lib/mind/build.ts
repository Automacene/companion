/**
 * Companion's mind, built from settings rather than stored as a file.
 *
 * A static mind file would contradict the model settings the moment somebody
 * changed `num_ctx`. Deriving the mind from the same number the user already
 * sets means the two can never disagree.
 *
 * ── The pools ──────────────────────────────────────────────────
 *
 *   window   this tab's closed turns, sent verbatim, ages into the archive
 *   context  this tab's current page, exactly one, ages into the scrapes
 *   thread   this tab's turn ids, in order, never evicted
 *   archive  every tab's past turns, searched not replayed
 *   scraped  every page ever read, in pieces, searched not replayed
 *
 * `extends: false` matters. Without it the library layers this onto
 * DEFAULT_MIND, and the thinking, action, and tool pools come back — which is
 * the opposite of the intent, since none of them are used and a tool pool will
 * want a different arrangement when tools do arrive.
 *
 * ── Why a page gets its own pool ───────────────────────────────
 *
 * A page used to ride on the turn as a field, which put it in two bad places at
 * once. In history it had to be suppressed, because replaying a twelve-thousand
 * character page on every subsequent turn grows the prompt without bound — so
 * the page became unreachable the moment its turn closed. And in the archive it
 * was indexed as part of the turn, so the whole page matched as one unit: a
 * question answered by one paragraph would recall all of it or none of it.
 *
 * Its own pool fixes both. The current page is held once per tab and sent whole
 * while it is current. When the next page replaces it, it is cut into pieces
 * and those go to `scraped`, where recall can return the paragraph that matched
 * rather than the document that contained it.
 *
 * ── Why `thread` exists ────────────────────────────────────────
 *
 * The panel rebuilds itself from storage whenever you switch tabs, and it
 * cannot use the window pool for that: eviction moves older turns to the
 * archive and they would vanish from the scrollback while the model could still
 * recall them. An ordered list of ids survives eviction — liminal ids are unique
 * across pools and `moveTo` carries them over — so rendering reads the list and
 * fetches each turn wherever it now lives.
 */
import { DEFAULT_MIND, tokenBudget, nodeCount, moveTo, KIND } from '@automacene/conversation';
import { resolveBudgets, type MemoryShares } from './memory-params';
import { makeAssembler } from './assemble';
import { chunkTo } from './chunk-evict';
import { DEFAULT_SYSTEM_PROMPT } from '../constants';
import type { ExtensionSettings } from '../../types/state';

/** Fallback when `num_ctx` is unset, matching what Ollama loads by default. */
const FALLBACK_CONTEXT = 4096;

/** Tokens per character, for turning the extractor's cap into a token figure. */
const CHARS_PER_TOKEN = 4;

export function contextTokensOf(settings: ExtensionSettings): number {
  const raw = Number(settings.modelParams?.num_ctx);
  return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_CONTEXT;
}

/**
 * How many characters a page read may keep.
 *
 * Derived from the page share rather than set separately, so the extractor and
 * the prompt budget cannot disagree about how much room a page gets.
 */
export function pageCharBudget(settings: ExtensionSettings): number {
  const { tokens } = resolveBudgets(
    settings.memory as MemoryShares | undefined,
    contextTokensOf(settings),
  );
  return Math.max(1000, tokens.pageShare * CHARS_PER_TOKEN);
}

export function buildMind(settings: ExtensionSettings) {
  const contextTokens = contextTokensOf(settings);
  const { tokens } = resolveBudgets(settings.memory as MemoryShares | undefined, contextTokens);

  const systemPrompt = settings.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  return {
    name: 'companion',

    /*
      Stands alone rather than layering onto the library's default, so removing
      a pool actually removes it. Thinking, action, and tools are gone: nothing
      produces into them, an empty pool still costs a scope entry per tab, and
      leaving a `tools` pool shaped by the default would prejudge an
      arrangement that is not designed yet.
    */
    extends: false as const,

    /*
      Which pool the library's own `search`, `appendNote`, and `prune` default
      to. It has to be named now that two pools declare `holds: "*"` — the
      fallback is "whichever catch-all comes first", and that is not a thing to
      leave to key order.
    */
    archive: 'archive',

    pools: {
      window: {
        holds: KIND.TURN,
        scoped: true,
        eviction: 'windowEviction',
        onEvict: 'toArchive',
        context: { mode: 'whole' as const },
      },

      /*
        The page currently attached to this tab.

        One node, because "the page you are looking at" is singular. Replacing
        it is what evicts the old one, so `nodeCount` is the whole policy: put a
        second page in and the first leaves.

        This replaces a Map held in the dispatcher that was consumed by the very
        next message. A pool persists, so the page survives the worker being
        killed and stays attached across several questions instead of one.
      */
      context: {
        holds: '*',
        scoped: true,
        eviction: 'contextEviction',
        onEvict: 'toScraped',
        context: { mode: 'whole' as const },
      },

      // Scrollback ids. No eviction at all — that is the point of it. It only
      // holds ids, so a year of browsing is still a few hundred kilobytes.
      thread: {
        holds: '*',
        scoped: true,
        context: null,
      },

      /*
        Past conversation, from every tab.

        Recall is keyword matching, so the count is what decides whether an
        older memory can surface at all — the token budget only caps how much of
        what surfaced is kept.
      */
      archive: {
        holds: '*',
        context: { mode: 'ranked' as const, limit: tokens.recallCount, rerank: true },
      },

      /*
        Every page ever read, in pieces.

        Separate from the conversation archive because the two answer different
        questions and compete badly in one index. A page fragment is dense
        reference text; a turn is an exchange. Ranking them together means a
        long page outscores a short answer on term overlap alone, and the
        exchange that actually addressed the question loses to the document it
        was about.
      */
      scraped: {
        holds: '*',
        context: { mode: 'ranked' as const, limit: tokens.scrapeRecallCount, rerank: true },
      },
    },

    turn: DEFAULT_MIND.turn,

    /*
      The system prompt lives in the template, and companion's assembler reads
      everything before the first placeholder as the system message. The
      placeholders are still here so the library's own assembler keeps working
      if the hook is ever removed.
    */
    assemble: {
      template: `${systemPrompt}\n\n{scraped}\n\n{archive}\n\n{context}\n\n{window}\n\n{query}`,
      headings: {
        scraped: '# From pages you have read',
        archive: '# Recalled from earlier browsing',
        context: '# The page you are looking at',
        window: '# Conversation so far',
        query: '# Current message',
      },
    },
  };
}

/**
 * The hooks that go with the mind above.
 *
 * Budgets are supplied here rather than in the mind because the mind names a
 * hook and the hook holds the number. `windowEviction` in the mind is a name;
 * this is what it resolves to.
 */
export function buildHooks(settings: ExtensionSettings) {
  const { tokens } = resolveBudgets(
    settings.memory as MemoryShares | undefined,
    contextTokensOf(settings),
  );

  return {
    windowEviction: tokenBudget({ tokens: tokens.windowShare, fields: ['query', 'response'] }),
    toArchive: moveTo(),

    // One page at a time. A second arriving is what sends the first to be cut up.
    contextEviction: nodeCount({ max: 1 }),
    toScraped: chunkTo('scraped'),

    // Recalled material shares one token budget across both ranked pools.
    assemble: makeAssembler(tokens.archiveShare),
  };
}
