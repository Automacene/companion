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
    id: 'replyShare',
    inPrompt: true,
    label: 'Room to answer',
    description:
      'Held back so the model has space to reply. Everything else divides what is left.',
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
    description:
      'Room for what gets recalled from other tabs and earlier browsing.',
    defaultShare: 0.15,
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    id: 'thinkingShare',
    inPrompt: false,
    label: 'Reasoning',
    description:
      'Kept for a reasoning model to work in. Not sent in the prompt; it is stored and archived.',
    defaultShare: 0.08,
    min: 0,
    max: 0.4,
    step: 0.01,
  },
  {
    id: 'actionShare',
    inPrompt: false,
    label: 'Tool results',
    description: 'Kept for what tools returned. Also stored rather than sent.',
    defaultShare: 0.08,
    min: 0,
    max: 0.4,
    step: 0.01,
  },
];

export const MEMORY_PARAMS_BY_ID = new Map(MEMORY_PARAMS.map((p) => [p.id, p]));

export type MemoryShares = Record<string, number>;

/**
 * The ids, named rather than left as strings.
 *
 * `resolveBudgets` writes every one of them, so callers never have to guard a
 * missing value, and a typo in a budget name fails to compile instead of
 * silently resolving to zero tokens.
 */
export type MemoryParamId =
  | 'replyShare'
  | 'pageShare'
  | 'windowShare'
  | 'archiveShare'
  | 'thinkingShare'
  | 'actionShare';

export type Budgets = Record<MemoryParamId, number>;

export const DEFAULT_MEMORY: MemoryShares = Object.fromEntries(
  MEMORY_PARAMS.map((p) => [p.id, p.defaultShare])
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
  contextTokens: number
): { tokens: Budgets; total: number; over: boolean } {
  const tokens = {} as Budgets;
  let total = 0;

  for (const param of MEMORY_PARAMS) {
    const value = Math.max(0, Math.round(contextTokens * shareOf(memory, param.id)));
    tokens[param.id] = value;
    if (param.inPrompt) total += value;
  }


  return { tokens, total, over: total > contextTokens };
}
