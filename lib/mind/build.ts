/**
 * Companion's mind, built from settings rather than stored as a file.
 *
 * A static mind would contradict `num_ctx` the moment it changed, so every
 * budget here is derived from the same number the user sets.
 *
 * Pools: `window` (this tab's turns, ageing into `archive`), `context` (the one
 * page this tab has open, ageing into `scraped` in pieces), `thread` (turn ids
 * for the panel's scrollback, never evicted), plus the two shared stores.
 *
 * `extends: false` is load-bearing. Without it the library layers this onto
 * DEFAULT_MIND and the unused thinking, action and tool pools come back.
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

    // Stands alone rather than layering onto the library's default, so removing a pool actually removes it.
    extends: false as const,

    // Which pool the library's own `search`, `appendNote`, and `prune` default to.
    archive: 'archive',

    pools: {
      window: {
        holds: KIND.TURN,
        scoped: true,
        eviction: 'windowEviction',
        onEvict: 'toArchive',
        context: { mode: 'whole' as const },
      },

      // The page currently attached to this tab.
      context: {
        holds: '*',
        scoped: true,
        eviction: 'contextEviction',
        onEvict: 'toScraped',
        context: { mode: 'whole' as const },
      },

      // Scrollback ids.
      thread: {
        holds: '*',
        scoped: true,
        context: null,
      },

      // Past conversation, from every tab.
      archive: {
        holds: '*',
        context: { mode: 'ranked' as const, limit: tokens.recallCount, rerank: true },
      },

      // Every page ever read, in pieces.
      scraped: {
        holds: '*',
        context: { mode: 'ranked' as const, limit: tokens.scrapeRecallCount, rerank: true },
      },
    },

    turn: DEFAULT_MIND.turn,

    // The assembler reads everything before the first placeholder as the system message.
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
