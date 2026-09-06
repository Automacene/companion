/**
 * Metrics from the most recent generation.
 *
 * Ollama attaches timings and token counts to the final object of a response -
 * the `done: true` chunk in a stream, or the whole body when not streaming.
 * They were being read and discarded.
 *
 * Kept under its own storage key rather than in settings, because settings are
 * a document the user edits and this is a reading taken from the last run. A
 * page that saves settings should never be able to write over it, and pruning
 * an unknown key out of settings should never delete it.
 */

const STORAGE_KEY = 'lastRun';

/** Raw fields as Ollama reports them. All durations are nanoseconds. */
export interface LastRun {
  model: string;
  at: number;
  /** Wall time for the whole request. */
  totalDuration: number;
  /**
   * Time spent getting the model into memory. Large means a cold load, which
   * is the answer to "why did that one take a minute".
   */
  loadDuration: number;
  promptEvalCount: number;
  promptEvalDuration: number;
  evalCount: number;
  evalDuration: number;
  /** `stop`, `length` when it hit the reply limit, or `load` on failure. */
  doneReason: string | null;
}

/**
 * Pull the metrics out of a final response object.
 *
 * Returns null for a chunk that is not the last one, so a caller can hand every
 * parsed line to it without checking first.
 */
export function readMetrics(payload: any, model: string): LastRun | null {
  if (!payload || payload.done !== true) return null;

  return {
    model: payload.model ?? model,
    at: Date.now(),
    totalDuration: Number(payload.total_duration) || 0,
    loadDuration: Number(payload.load_duration) || 0,
    promptEvalCount: Number(payload.prompt_eval_count) || 0,
    promptEvalDuration: Number(payload.prompt_eval_duration) || 0,
    evalCount: Number(payload.eval_count) || 0,
    evalDuration: Number(payload.eval_duration) || 0,
    doneReason: payload.done_reason ?? null,
  };
}

export async function saveLastRun(run: LastRun): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: run });
  } catch {
    // Telemetry is not worth failing a reply over.
  }
}

export async function readLastRun(): Promise<LastRun | null> {
  try {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    return (stored[STORAGE_KEY] as LastRun) ?? null;
  } catch {
    return null;
  }
}

/** Derived figures, which are what anyone actually wants to read. */
export interface RunSummary {
  /** Tokens per second while generating. The headline number. */
  tokensPerSecond: number | null;
  /** Tokens per second while reading the prompt. Usually much faster. */
  promptTokensPerSecond: number | null;
  /** Whether the model had to be loaded first. */
  wasColdLoad: boolean;
  /** Share of the total spent loading rather than generating, 0 to 1. */
  loadShare: number;
  /** True when generation stopped because it hit `num_predict`, not naturally. */
  hitReplyLimit: boolean;
}

const COLD_LOAD_THRESHOLD_NS = 1e9; // a second

export function summarise(run: LastRun): RunSummary {
  const rate = (count: number, duration: number) =>
    duration > 0 && count > 0 ? count / (duration / 1e9) : null;

  return {
    tokensPerSecond: rate(run.evalCount, run.evalDuration),
    promptTokensPerSecond: rate(run.promptEvalCount, run.promptEvalDuration),
    // A warm model still reports a small load duration for the lookup.
    wasColdLoad: run.loadDuration > COLD_LOAD_THRESHOLD_NS,
    loadShare: run.totalDuration > 0 ? run.loadDuration / run.totalDuration : 0,
    hitReplyLimit: run.doneReason === 'length',
  };
}
