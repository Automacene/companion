/**
 * Keeping the service worker alive across a long wait.
 *
 * MV3 shuts the worker down after about thirty seconds in which nothing
 * happens on it. A pending `fetch` does not count: the worker is idle from the
 * browser's point of view until bytes actually arrive, so a request that takes
 * a long time to produce its first byte gets its worker killed out from under
 * it and the fetch is aborted.
 *
 * The first message to a model that is not loaded yet is exactly that request.
 * Ollama has to read the weights off disk, fit them to the GPU, and allocate
 * the KV cache before it writes a single token, which on a large context is
 * comfortably past thirty seconds. What the user saw was the panel reporting
 * that the extension restarted while replying; what Ollama logged was
 * `context canceled`, because from its side the client had hung up. Neither
 * end was at fault — the worker had simply been collected while waiting.
 *
 * Calling any extension API counts as activity and resets the timer.
 * `getPlatformInfo` is used because it reads nothing, changes nothing, and
 * cannot fail in a way that matters here.
 */

/** Comfortably inside the roughly thirty second idle shutdown. */
const PING_MS = 20_000;

/**
 * Hold the worker open for as long as `work` takes.
 *
 * The interval is cleared in `finally`, so a thrown error stops the pings just
 * as a normal return does. Leaving one running would keep the worker resident
 * for the rest of the browser session and defeat the point of MV3 unloading it.
 */
export async function keepAwake<T>(work: () => Promise<T>): Promise<T> {
  const ping = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {
      /*
        The only way this fails is the worker already going away, which is the
        thing being prevented rather than something to report. Swallowed so an
        unhandled rejection from a timer cannot take down the actual work.
      */
    });
  }, PING_MS);

  try {
    return await work();
  } finally {
    clearInterval(ping);
  }
}
