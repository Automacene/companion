/**
 * The generation parameters Ollama accepts, as data.
 *
 * One list drives three things: the controls on the model page, the request
 * body sent to Ollama, and the migration of older stored settings. Adding a
 * parameter here adds a control and starts sending it, with no second file to
 * remember.
 *
 * ── What is in the list, and what is not ────────────────────────
 * Everything here was verified against a running Ollama 0.32.14 by sending it
 * and reading the value back out of the server log. Three kinds of thing are
 * deliberately absent:
 *
 *   mirostat, mirostat_tau, mirostat_eta
 *       Silently ignored. Sent `mirostat: 2` and the runner still reported
 *       `mirostat = 0`. A control that does nothing is worse than no control.
 *
 *   use_mmap, use_mlock, low_vram, main_gpu, vocab_only, logits_all
 *       Deployment concerns rather than generation ones, and the ones that can
 *       stop a model loading at all. Not a knob to hand somebody in a browser.
 *
 *   tools
 *       Real, and `/api/show` reports llama3.2 supports it, but a tool
 *       definition is not a form field. It belongs with the addon work.
 *
 * ── Omission means "model default" ─────────────────────────────
 * Ollama has no value meaning "use the default" — only absence. So a blank
 * control removes the key rather than sending a zero, which is why every value
 * here is optional and why `RANGE.min` exists separately from "unset".
 */

/** Where a parameter goes in the request body. */
export type ParamTarget = 'options' | 'body';

export type ParamKind = 'float' | 'int' | 'select' | 'text';

export interface ParamDef {
  /** Ollama's own key. Also the storage key, so the two can never drift. */
  id: string;
  label: string;
  description: string;
  group: string;
  kind: ParamKind;
  target: ParamTarget;
  min?: number;
  max?: number;
  step?: number;
  /**
   * What the model does when this is not set, where that is a knowable number.
   *
   * Taken from what the runner actually reports on a cold load, not from the
   * documentation — Ollama documents `repeat_penalty` as 1.1, for instance,
   * while the server logs `repeat_penalty = 1.000` when nothing is sent.
   *
   * Used to park the slider somewhere honest and to label the empty box. It is
   * never sent: leaving a control at its default still omits the key, so the
   * model stays free to disagree.
   *
   * Absent where there is no single number — a random seed, or a thread count
   * that depends on the machine.
   */
  defaultValue?: number;
  /** Shown in the control when nothing is set: what the model does on its own. */
  placeholder?: string;
  choices?: { value: string; label: string }[];
}

export const PARAM_GROUPS = [
  'Randomness',
  'Repetition',
  'Length & context',
  'Output',
  'Hardware',
] as const;

export const PARAMS: ParamDef[] = [
  // ── Randomness ───────────────────────────────────────────────
  {
    id: 'temperature',
    label: 'Temperature',
    description: 'Higher wanders further. Zero is as close to deterministic as the model gets.',
    group: 'Randomness',
    kind: 'float',
    target: 'options',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: 0.8,
  },
  {
    id: 'top_p',
    label: 'Top-P',
    description: 'Consider only the most likely tokens adding up to this probability.',
    group: 'Randomness',
    kind: 'float',
    target: 'options',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.9,
  },
  {
    id: 'top_k',
    label: 'Top-K',
    description: 'Consider only this many candidates at each step. 0 turns it off.',
    group: 'Randomness',
    kind: 'int',
    target: 'options',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 40,
  },
  {
    id: 'min_p',
    label: 'Min-P',
    description:
      'Drop tokens less likely than this share of the top candidate. Usually better behaved than Top-P; use one or the other.',
    group: 'Randomness',
    kind: 'float',
    target: 'options',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0,
  },
  {
    id: 'typical_p',
    label: 'Typical-P',
    description: 'Prefers tokens of average surprise rather than simply the most likely.',
    group: 'Randomness',
    kind: 'float',
    target: 'options',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 1,
  },
  {
    id: 'seed',
    label: 'Seed',
    description:
      'Fixes the randomness, so the same prompt gives the same answer. Leave blank for a new one each time.',
    group: 'Randomness',
    kind: 'int',
    target: 'options',
    min: 0,
    max: 2147483647,
    step: 1,
    placeholder: 'random',
  },

  // ── Repetition ───────────────────────────────────────────────
  {
    id: 'repeat_penalty',
    label: 'Repeat penalty',
    description: 'How hard to push away from words it has already used. 1.0 is no penalty.',
    group: 'Repetition',
    kind: 'float',
    target: 'options',
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 1,
  },
  {
    id: 'repeat_last_n',
    label: 'Repeat window',
    description:
      'How far back the repeat penalty looks, in tokens. -1 uses the whole context, 0 disables it. The default of 64 is short.',
    group: 'Repetition',
    kind: 'int',
    target: 'options',
    min: -1,
    max: 4096,
    step: 1,
    defaultValue: 64,
  },
  {
    id: 'presence_penalty',
    label: 'Presence penalty',
    description: 'Flat penalty for any word already used, regardless of how often.',
    group: 'Repetition',
    kind: 'float',
    target: 'options',
    min: -2,
    max: 2,
    step: 0.01,
    defaultValue: 0,
  },
  {
    id: 'frequency_penalty',
    label: 'Frequency penalty',
    description: 'Penalty that grows with how often a word has been used.',
    group: 'Repetition',
    kind: 'float',
    target: 'options',
    min: -2,
    max: 2,
    step: 0.01,
    defaultValue: 0,
  },

  // ── Length & context ─────────────────────────────────────────
  {
    id: 'num_ctx',
    label: 'Context window',
    description:
      'How many tokens the model can see at once. Larger costs more memory, and cannot exceed what the model was trained for.',
    group: 'Length & context',
    kind: 'int',
    target: 'options',
    min: 256,
    max: 131072,
    step: 256,
    defaultValue: 4096,
  },
  {
    id: 'num_predict',
    label: 'Reply limit',
    description: 'Most tokens to generate. -1 is unlimited, -2 fills the remaining context.',
    group: 'Length & context',
    kind: 'int',
    target: 'options',
    min: -2,
    max: 16384,
    step: 16,
    placeholder: 'unlimited',
  },
  {
    id: 'num_keep',
    label: 'Tokens to keep',
    description:
      'Tokens held at the front when the context fills, so the system prompt survives being pushed out.',
    group: 'Length & context',
    kind: 'int',
    target: 'options',
    min: 0,
    max: 2048,
    step: 1,
    defaultValue: 4,
  },
  {
    id: 'stop',
    label: 'Stop sequences',
    description: 'Comma separated. Generation halts as soon as one appears.',
    group: 'Length & context',
    kind: 'text',
    target: 'options',
    placeholder: 'e.g. USER:, END',
  },
  {
    id: 'keep_alive',
    label: 'Keep model loaded',
    description:
      'How long the model stays in memory after a reply. -1 keeps it forever. The five minute default is why the first message after a pause is slow.',
    group: 'Length & context',
    kind: 'text',
    target: 'body',
    placeholder: '5m',
  },

  // ── Output ───────────────────────────────────────────────────
  {
    id: 'format',
    label: 'Response format',
    description:
      'JSON constrains decoding so the reply cannot come back malformed. Only useful when you are parsing it.',
    group: 'Output',
    kind: 'select',
    target: 'body',
    choices: [
      { value: '', label: 'Plain text' },
      { value: 'json', label: 'JSON' },
    ],
  },
  {
    id: 'think',
    label: 'Show reasoning',
    description:
      'Reasoning models work through a problem before answering. Off discards that step; on returns it separately from the reply. Ignored by models that do not reason.',
    group: 'Output',
    kind: 'select',
    target: 'body',
    choices: [
      { value: '', label: "Model's choice" },
      { value: 'true', label: 'On' },
      { value: 'false', label: 'Off' },
    ],
  },

  // ── Hardware ─────────────────────────────────────────────────
  {
    id: 'num_gpu',
    label: 'Layers on GPU',
    description:
      'How many layers to put in VRAM. Lower this when a model does not fit and is spilling to the CPU. 0 runs entirely on the CPU.',
    group: 'Hardware',
    kind: 'int',
    target: 'options',
    min: 0,
    max: 256,
    step: 1,
    placeholder: 'as many as fit',
  },
  {
    id: 'num_batch',
    label: 'Batch size',
    description: 'Tokens processed together while reading the prompt. Larger is faster and uses more memory.',
    group: 'Hardware',
    kind: 'int',
    target: 'options',
    min: 32,
    max: 4096,
    step: 32,
    defaultValue: 512,
  },
  {
    id: 'num_thread',
    label: 'CPU threads',
    description: 'Threads for any work not on the GPU. Defaults to your physical core count.',
    group: 'Hardware',
    kind: 'int',
    target: 'options',
    min: 1,
    max: 128,
    step: 1,
    placeholder: 'auto',
  },
];

export const PARAMS_BY_ID = new Map(PARAMS.map((param) => [param.id, param]));

/**
 * What to show in an empty control.
 *
 * Derived from `defaultValue` where there is one, so the hint and the slider's
 * resting position can never claim different things. `placeholder` is only
 * written by hand for parameters whose default is not a number — a random seed,
 * or a thread count that depends on the machine.
 */
export function placeholderFor(param: ParamDef): string {
  if (param.defaultValue !== undefined) return String(param.defaultValue);
  return param.placeholder ?? 'model default';
}

/** What the user has set, keyed by parameter id. Absent means "model default". */
export type ParamValues = Record<string, string | number | boolean>;

/**
 * Older settings kept one flat field per parameter under a different name.
 * Used once, to carry existing values into the new shape rather than silently
 * resetting somebody's tuning.
 */
export const LEGACY_FIELDS: Record<string, string> = {
  temperature: 'temperature',
  topP: 'top_p',
  topK: 'top_k',
  repeatPenalty: 'repeat_penalty',
  numCtx: 'num_ctx',
  numPredict: 'num_predict',
  stopSeq: 'stop',
  keepAlive: 'keep_alive',
};

/**
 * Coerce a stored value into what Ollama should receive, or undefined to omit.
 *
 * Range is enforced here rather than trusted from the control, because values
 * also arrive from storage written by an older build or edited by hand.
 */
export function coerce(param: ParamDef, raw: unknown): string | number | boolean | string[] | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (param.kind === 'select') {
    const value = String(raw);
    if (value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }

  if (param.kind === 'text') {
    const value = String(raw).trim();
    if (value === '') return undefined;

    if (param.id === 'stop') {
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    }

    // keep_alive takes a duration string or a number of seconds. Sending a
    // bare number as a number avoids it being read as a duration.
    if (param.id === 'keep_alive') {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) ? asNumber : value;
    }

    return value;
  }

  // Numbers. An empty string is a cleared control, not a zero — the previous
  // code did `parseInt(value) || 0` and stored 0, which asked Ollama for a
  // zero-token context window.
  if (raw === '') return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;

  const min = param.min ?? Number.NEGATIVE_INFINITY;
  const max = param.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(max, Math.max(min, parsed));

  return param.kind === 'int' ? Math.round(clamped) : clamped;
}
