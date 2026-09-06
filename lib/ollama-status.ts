/**
 * What the Ollama server will tell a browser about itself.
 *
 * Worth being clear about the limit up front: the interesting diagnostics we
 * have been reading during development - the sampler parameters llama.cpp
 * echoes back, the layer offload counts - live in the server's stdout, which
 * an extension cannot reach. There is no API for them.
 *
 * What the HTTP API does expose is enough to answer the questions that actually
 * come up:
 *
 *   Is it running, and what version   /api/version
 *   Which models are resident, how much sits in VRAM, and when they expire
 *                                     /api/ps
 *   What a model can actually do      /api/show
 *   How the last run performed        metadata on the final chat response,
 *                                     captured by `lib/last-run.ts`
 *
 * The VRAM split is the one worth having. `size` against `size_vram` is how
 * `ollama ps` works out "100% GPU" versus "13%/87% CPU/GPU", which is the
 * difference between a model that fits and one that is crawling.
 */

/** Nanoseconds, as every duration in Ollama's API is reported. */
export type Nanoseconds = number;

export interface LoadedModel {
  name: string;
  /** Total size of the loaded model, in bytes. */
  size: number;
  /** How much of that is in VRAM. Equal to `size` when fully offloaded. */
  sizeVram: number;
  /** Share on the GPU, 0 to 1. */
  gpuShare: number;
  /** When Ollama will unload it, or null if it never will. */
  expiresAt: Date | null;
  /** The context window it was actually loaded with. */
  contextLength: number | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface ServerStatus {
  reachable: boolean;
  version: string | null;
  loaded: LoadedModel[];
  /** Why the check failed, when it did. */
  error?: string;
}

/**
 * Ask the server how it is doing.
 *
 * Never rejects. This drives a status panel, and a panel that throws on a
 * stopped server is worse than one that says the server is stopped.
 *
 * @param timeoutMs  the connection timeout setting. Applied here and nowhere
 *   near generation, where a cold model load legitimately takes a minute.
 */
export async function fetchServerStatus(hostUrl: string, timeoutMs = 5000): Promise<ServerStatus> {
  const host = hostUrl.replace(/\/+$/, '');

  try {
    const [version, ps] = await Promise.all([
      getJson(`${host}/api/version`, timeoutMs),
      getJson(`${host}/api/ps`, timeoutMs),
    ]);

    return {
      reachable: true,
      version: typeof version?.version === 'string' ? version.version : null,
      loaded: (Array.isArray(ps?.models) ? ps.models : []).map(toLoadedModel),
    };
  } catch (error) {
    return {
      reachable: false,
      version: null,
      loaded: [],
      error: error instanceof Error ? error.message : 'Could not reach Ollama',
    };
  }
}

function toLoadedModel(raw: Record<string, any>): LoadedModel {
  const size = Number(raw.size) || 0;
  const sizeVram = Number(raw.size_vram) || 0;
  const details = raw.details ?? {};

  return {
    name: String(raw.name ?? raw.model ?? 'unknown'),
    size,
    sizeVram,
    // Guarded rather than a bare divide.
    gpuShare: size > 0 ? Math.min(1, sizeVram / size) : 0,
    expiresAt: parseExpiry(raw.expires_at),
    contextLength: Number(raw.context_length) || null,
    parameterSize: details.parameter_size ?? null,
    quantization: details.quantization_level ?? null,
  };
}

/**
 * Ollama writes a far-future timestamp for a model pinned with `keep_alive: -1`
 * rather than omitting the field, so anything beyond a year out is treated as
 * "never expires" instead of being rendered as a nonsense countdown.
 */
function parseExpiry(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  const aYearOut = Date.now() + 365 * 24 * 60 * 60 * 1000;
  return date.getTime() > aYearOut ? null : date;
}

async function getJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Details of one model, including what it is actually capable of. */
export interface ModelDetail {
  contextLength: number | null;
  capabilities: string[];
  parameterCount: number | null;
  /** The model's own baked-in parameter overrides, as text. */
  parameters: string | null;
}

/**
 * What a model supports, from `/api/show`.
 *
 * `contextLength` is the useful one: it is the real ceiling for `num_ctx`, so a
 * context slider can stop somebody asking a 8k model for 131k.
 */
export async function fetchModelDetail(
  hostUrl: string,
  model: string,
  timeoutMs = 5000,
): Promise<ModelDetail | null> {
  const host = hostUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = await response.json();
    const info = data?.model_info ?? {};

    // The key is namespaced by architecture - `llama.context_length`.
    const contextKey = Object.keys(info).find((key) => key.endsWith('.context_length'));

    return {
      contextLength: contextKey ? Number(info[contextKey]) || null : null,
      capabilities: Array.isArray(data?.capabilities) ? data.capabilities : [],
      parameterCount: Number(info['general.parameter_count']) || null,
      parameters: typeof data?.parameters === 'string' ? data.parameters : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Formatting ───────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(nanoseconds: Nanoseconds): string {
  const ms = nanoseconds / 1e6;
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** "in 4m 12s", or "expired" once it is past. */
export function formatCountdown(target: Date | null): string {
  if (!target) return 'stays loaded';

  const remaining = target.getTime() - Date.now();
  if (remaining <= 0) return 'unloading';

  const seconds = Math.round(remaining / 1000);
  if (seconds < 60) return `${seconds}s left`;

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s left`;
}
