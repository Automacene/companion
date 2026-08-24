/**
 * Sending a one-off message to the background worker.
 *
 * MV3 stops the service worker whenever it goes idle. Sending it a message is
 * supposed to start it again, and it does — but the message and the worker's
 * listener registration race each other. When the message wins, there is no
 * listener yet to receive it, and Chrome resolves `sendMessage` with
 * `undefined` instead of rejecting.
 *
 * That failure is the hard one to find, because nothing announces it. No
 * exception is thrown, nothing is written to the console, and the caller gets
 * `undefined` — which is exactly what a listener that declined to answer also
 * returns. A page that opens cold and asks the worker one question therefore
 * appears to be talking to a broken handler when the handler is fine and simply
 * was not listening yet.
 *
 * It hits pages harder than it hits the sidepanel. The sidepanel holds a
 * long-lived port, and `connect()` does not drop this way, so it kept working
 * while every page that used `sendMessage` failed on open.
 *
 * Retrying is what fixes it: the first attempt is what starts the worker, so by
 * the second attempt the listeners exist. The delay grows between attempts
 * because a cold start also has to evaluate the whole background bundle.
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
 * failed to start or has no handler for this action — a real fault worth
 * showing the user, unlike the cold start this absorbs.
 */
export async function askWorker<T = any>(message: object): Promise<T> {
  let response: T | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      response = (await browser.runtime.sendMessage(message)) as T | undefined;
    } catch {
      /*
        "Could not establish connection. Receiving end does not exist." is the
        same cold worker reported as a rejection rather than as `undefined`,
        so it gets the same retry. A handler that throws does not land here —
        its error comes back inside a resolved response.
      */
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
