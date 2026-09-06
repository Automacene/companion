/**
 * Sending a one-off message to the background worker.
 *
 * MV3 stops the worker on idle. Sending it a message starts it again, but the
 * message and the listener registration race: when the message wins, Chrome
 * resolves `sendMessage` with `undefined` rather than rejecting, so the failure
 * is silent and looks identical to a handler that declined to answer.
 *
 * Retrying fixes it, because the first attempt is what wakes the worker.
 */

/** Attempts before giving up. The first is usually the one that wakes it. */
const ATTEMPTS = 4;

/** Base gap between attempts, multiplied by the attempt number. */
const DELAY_MS = 150;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a message and wait for the worker's reply, starting it if it is asleep.
 *
 * Resolves with whatever the handler passed to `sendResponse`. Rejects only
 * when the worker stayed silent across every attempt, which means it genuinely
 * failed to start or has no handler for this action - a real fault worth
 * showing the user, unlike the cold start this absorbs.
 */
export async function askWorker<T = any>(message: object): Promise<T> {
  let response: T | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      response = (await browser.runtime.sendMessage(message)) as T | undefined;
    } catch {
      // "Could not establish connection.
      response = undefined;
    }

    if (response !== undefined && response !== null) return response;

    if (attempt < ATTEMPTS - 1) await wait(DELAY_MS * (attempt + 1));
  }

  throw new Error(
    `The background worker did not answer after ${ATTEMPTS} attempts. ` +
      'Open its console from the extensions page to see whether it failed to start.',
  );
}
