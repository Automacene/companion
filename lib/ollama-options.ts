/**
 * Turning stored parameter values into an Ollama request.
 *
 * These settings used to be collected by the options page and then dropped:
 * the request carried `model`, `messages`, and `stream` and nothing else. The
 * server log proved it — a run with temperature 0.7 and repeat penalty 1.1
 * reported llama.cpp's own defaults straight back:
 *
 *   top_k = 40, top_p = 0.900, temp = 0.800, repeat_penalty = 1.000
 *
 * Nothing here knows any parameter by name. The list lives in
 * `lib/model-params.ts`, and each entry says whether it belongs under
 * `options` or at the top level of the body, so adding one is a single edit
 * there.
 *
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */
import { PARAMS, coerce, type ParamValues } from './model-params';
import type { ExtensionSettings } from '../types/state';

/** Sampling block. Anything absent means "use the model's default". */
export type OllamaOptions = Record<string, string | number | boolean | string[]>;

/** Top-level body fields other than model, messages, and stream. */
export type OllamaBodyExtras = Record<string, string | number | boolean | string[]>;

export interface RequestShape {
  model: string;
  stream: boolean;
  options: OllamaOptions;
  extras: OllamaBodyExtras;
}

/**
 * Split the stored values into the two places Ollama expects them.
 *
 * Omission is the whole game: Ollama has no value meaning "default", so a
 * cleared control has to remove the key entirely. `coerce` returns undefined
 * for anything unset, out of range, or unparseable.
 */
export function buildRequestParts(values: ParamValues): {
  options: OllamaOptions;
  extras: OllamaBodyExtras;
} {
  const options: OllamaOptions = {};
  const extras: OllamaBodyExtras = {};

  for (const param of PARAMS) {
    const value = coerce(param, values[param.id]);
    if (value === undefined) continue;

    if (param.target === 'options') options[param.id] = value;
    else extras[param.id] = value;
  }

  return { options, extras };
}

/** Everything the request needs, derived from settings in one place. */
export function buildRequestShape(settings: ExtensionSettings, model: string): RequestShape {
  const { options, extras } = buildRequestParts((settings.modelParams ?? {}) as ParamValues);

  return {
    model,
    // Explicitly boolean: the setting is optional, and `undefined` would make
    // Ollama stream anyway, which the non-streaming path would then mis-parse.
    stream: settings.streamResponses !== false,
    options,
    extras,
  };
}
