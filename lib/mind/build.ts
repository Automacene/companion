/**
 * Companion's mind, built from settings rather than stored as a file.
 *
 * A static mind file would contradict the model settings the moment somebody
 * changed `num_ctx`. The library's own default budgets 8,000 tokens for the
 * window plus 4,000 each for thinking and action — 16,000 before the archive
 * and tools are counted, against a window that defaults to 4,096. Nothing warns
 * you. Deriving the mind from the same `num_ctx` the user already sets means
 * the two can never disagree.
 *
 * The pools:
 *
 *   window    this tab's closed turns, sent verbatim, ages into the archive
 *   thinking  a reasoning model's working, stored not sent
 *   action    what tools returned, stored not sent
 *   archive   shared by every tab, searched not replayed — browsing history
 *   tools     shared, ranked per query, offered under masked ids
 *   thread    this tab's turn ids, in order, never evicted
 *
 * `thread` is the one that is not in the library's default. The panel rebuilds
 * itself from storage whenever you switch tabs, and it cannot use the window
 * pool for that, because eviction moves older turns to the archive and they
 * would silently vanish from the scrollback while the model could still recall
 * them. An ordered list of ids survives eviction — liminal ids are unique
 * across pools and `moveTo` carries them over — so rendering reads the list and
 * fetches each turn wherever it now lives.
 */
import { DEFAULT_MIND, tokenBudget, moveTo } from '@automacene/conversation';
import { resolveBudgets, type MemoryShares } from './memory-params';
import { assembleChat } from './assemble';
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
    contextTokensOf(settings)
  );
  return Math.max(1000, tokens.pageShare * CHARS_PER_TOKEN);
}

export function buildMind(settings: ExtensionSettings) {
  const contextTokens = contextTokensOf(settings);
  const { tokens } = resolveBudgets(settings.memory as MemoryShares | undefined, contextTokens);

  const systemPrompt = settings.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  return {
    ...DEFAULT_MIND,
    name: 'companion',

    pools: {
      ...DEFAULT_MIND.pools,

      window: { ...DEFAULT_MIND.pools.window, eviction: 'windowEviction', onEvict: 'toArchive' },
      thinking: { ...DEFAULT_MIND.pools.thinking, eviction: 'thinkingEviction' },
      action: { ...DEFAULT_MIND.pools.action, eviction: 'actionEviction' },

      /*
        How many memories a question may bring back.

        This was hardcoded at 5 and ignored the archive budget completely, so a
        128k window with 19,661 tokens allocated to recall was using a few
        hundred of them. It is a setting now.

        Recall is keyword matching, so the count is what decides whether an
        older memory can surface at all — the token budget only caps how much of
        what surfaced is kept.
      */
      archive: {
        ...DEFAULT_MIND.pools.archive,
        context: { mode: 'ranked', limit: tokens.recallCount, rerank: true },
      },

      /*
        The scrollback index. Scoped so each tab has its own, and with no
        eviction at all — that is the point of it. It only ever holds ids, so a
        year of browsing is still a few hundred kilobytes.
      */
      thread: {
        holds: '*',
        scoped: true,
        context: null,
      },
    },

    /*
      The system prompt lives in the template, and companion's assembler reads
      everything before the first placeholder as the system message. The
      placeholders are still here so the library's own assembler keeps working
      if the hook is ever removed.
    */
    assemble: {
      ...DEFAULT_MIND.assemble,
      template: `${systemPrompt}\n\n{tools}\n\n{archive}\n\n{window}\n\n{query}`,
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
    contextTokensOf(settings)
  );

  return {
    // Attached page text is excluded from the count. Otherwise one large page
    // read would evict an entire conversation on the turn it arrived.
    windowEviction: tokenBudget({ tokens: tokens.windowShare, fields: ['query', 'response'] }),
    thinkingEviction: tokenBudget({ tokens: tokens.thinkingShare }),
    actionEviction: tokenBudget({ tokens: tokens.actionShare }),

    toArchive: moveTo(),
    assemble: assembleChat,
  };
}
