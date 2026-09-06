/**
 * Keeping the service worker alive across a long wait.
 *
 * MV3 collects the worker after roughly thirty seconds of inactivity, and a
 * pending `fetch` does not count: it is idle until bytes arrive. The first
 * message to an unloaded model takes far longer than that, so the worker was
 * collected mid-request and the fetch aborted - Ollama logged `context
 * canceled` and the panel reported that the extension had restarted.
 *
 * Calling any extension API resets the timer.
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
      // Only fails when the worker is already going away, which is what this prevents.
    });
  }, PING_MS);

  try {
    return await work();
  } finally {
    clearInterval(ping);
  }
}
