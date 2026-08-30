/**
 * How the context window gets divided up, as user settings.
 *
 * Same arrangement as `lib/model-params.ts`: one list drives the controls, the
 * defaults, and the mind that gets built from them. Adding an entry here adds a
 * slider on the model page and changes the mind, with nothing else to edit.
 *
 * Everything is a SHARE of `num_ctx` rather than a token count, for one reason:
 * `num_ctx` is itself a user setting, and somebody running llama3.2 at 4,096
 * and somebody running qwen3.5 at 128,000 should not both have to work out
 * their own numbers. A share follows the window automatically.
 *
 * The shares are allowed to sum past 1. The model page shows the total against
 * `num_ctx` and `buildMind` clamps, because a configuration that over-commits
 * should degrade visibly rather than be silently rejected.
 */

export interface MemoryParamDef {
  id: MemoryParamId;
  label: string;
  description: string;
  /** Share of `num_ctx`, 0 to 1. */
  defaultShare: number;
  /**
   * Whether this budget occupies the context window.
   *
   * Thinking and action do not. Their pools carry `context: null` in the mind,
   * so `gather()` never hands them to the assembler — they are stored, attached
   * to the turn, and archived, but never sent. Counting them against `num_ctx`
   * would report every sane configuration as over budget.
   */
  inPrompt: boolean;
  min: number;
  max: number;
  step: number;
}

export const MEMORY_PARAMS: MemoryParamDef[] = [
  {
    /*
      Not a share — a count. How many archived items recall may return.

      It is here rather than derived from the archive share because the two
      bound different things: the share caps how much room recalled text may
      occupy, and this caps how many separate memories are considered at all.
      A generous share with a count of five still only ever sees five.
    */
    id: 'recallCount',
    inPrompt: false,
    label: 'Conversations recalled',
    description:
      'How many past exchanges a question may bring back from other tabs and earlier browsing. Recall is keyword matching, so this decides what can surface at all; the recalled-memory budget caps how much of it is kept.',
    defaultShare: 8,
    min: 0,
    max: 40,
    step: 1,
  },
  {
    /*
      Page fragments are counted separately from conversations because they are
      a different kind of memory and compete badly for one number. A page is
      dense reference text and a turn is an exchange, so ranking them together
      lets a long page outscore the answer that actually addressed the question.
      Two counts means neither can crowd the other out.
    */
    id: 'scrapeRecallCount',
    inPrompt: false,
    label: 'Page fragments recalled',
    description:
      'How many pieces of pages you have read a question may bring back. Pages are stored in fragments rather than whole, so recall returns the paragraph that matched instead of the entire document.',
    defaultShare: 4,
    min: 0,
    max: 40,
    step: 1,
  },
  {
    id: 'replyShare',
    inPrompt: true,
    label: 'Room to answer',
    description: 'Held back so the model has space to reply. Everything else divides what is left.',
    defaultShare: 0.25,
    min: 0.05,
    max: 0.6,
    step: 0.01,
  },
  {
    id: 'pageShare',
    inPrompt: true,
    label: 'Attached page',
    description:
      'Room for one page read. Reading a page is capped separately, so this only has to cover that cap.',
    defaultShare: 0.2,
    min: 0,
    max: 0.6,
    step: 0.01,
  },
  {
    id: 'windowShare',
    inPrompt: true,
    label: 'Conversation history',
    description:
      'How much of this tab stays in the prompt verbatim. Older turns age into the archive rather than being lost.',
    defaultShare: 0.3,
    min: 0.05,
    max: 0.8,
    step: 0.01,
  },
  {
    id: 'archiveShare',
    inPrompt: true,
    label: 'Recalled memory',
    description: 'Room for what gets recalled from other tabs and earlier browsing.',
    defaultShare: 0.15,
    min: 0,
    max: 0.5,
    step: 0.01,
  },
];

export const MEMORY_PARAMS_BY_ID = new Map(MEMORY_PARAMS.map((p) => [p.id, p]));

/**
 * The ones that are counts of items rather than shares of the window.
 *
 * They are taken as written instead of being multiplied by the context length,
 * which is the whole difference between "twelve memories" and "twelve tokens".
 */
const COUNT_PARAMS = new Set<MemoryParamId>(['recallCount', 'scrapeRecallCount']);

/**
 * Whether a param counts items rather than claiming a share of the window.
 *
 * Exported because the model page needs the same answer and was hardcoding one
 * id by name to get it. That is what let `scrapeRecallCount` render as
 * "400% · 4 tokens": it is a count of four, and every formatting rule for
 * shares is wrong about it.
 */
export function isCountParam(id: MemoryParamId): boolean {
  return COUNT_PARAMS.has(id);
}

/** What a count is counting, for the readout. */
export const COUNT_UNITS: Partial<Record<MemoryParamId, { one: string; many: string }>> = {
  recallCount: { one: 'memory', many: 'memories' },
  scrapeRecallCount: { one: 'fragment', many: 'fragments' },
};

export type MemoryShares = Record<string, number>;

/**
 * The ids, named rather than left as strings.
 *
 * `resolveBudgets` writes every one of them, so callers never have to guard a
 * missing value, and a typo in a budget name fails to compile instead of
 * silently resolving to zero tokens.
 */
export type MemoryParamId =
  'recallCount' | 'scrapeRecallCount' | 'replyShare' | 'pageShare' | 'windowShare' | 'archiveShare';

export type Budgets = Record<MemoryParamId, number>;

export const DEFAULT_MEMORY: MemoryShares = Object.fromEntries(
  MEMORY_PARAMS.map((p) => [p.id, p.defaultShare]),
);

/** A share, falling back to its default and clamped to its own range. */
export function shareOf(memory: MemoryShares | undefined, id: MemoryParamId): number {
  const def = MEMORY_PARAMS_BY_ID.get(id);
  if (!def) return 0;

  const raw = Number(memory?.[id]);
  if (!Number.isFinite(raw)) return def.defaultShare;

  return Math.min(def.max, Math.max(def.min, raw));
}

/**
 * Every share resolved to a token count, plus the total.
 *
 * `total` counts only the budgets that occupy the prompt, so it is the figure
 * the model page compares against `num_ctx`. It can exceed it, and saying so is
 * the point — the library's own defaults sum to 16,000 against a 4,096 window
 * and nothing anywhere mentions it.
 *
 * The shipped shares total 0.90, leaving room for the system prompt and the
 * tool offer, which are not budgeted separately.
 */
export function resolveBudgets(
  memory: MemoryShares | undefined,
  contextTokens: number,
): { tokens: Budgets; total: number; over: boolean } {
  const tokens = {} as Budgets;
  let total = 0;

  for (const param of MEMORY_PARAMS) {
    // `recallCount` is a count of items, not a share of the window, so it is
    // taken as written rather than multiplied by the context length.
    const value = COUNT_PARAMS.has(param.id)
      ? Math.round(shareOf(memory, param.id))
      : Math.max(0, Math.round(contextTokens * shareOf(memory, param.id)));

    tokens[param.id] = value;
    if (param.inPrompt) total += value;
  }

  return { tokens, total, over: total > contextTokens };
}
