/**
 * Telling the memory page that stored memory changed.
 *
 * IndexedDB itself has no equivalent of `browser.storage.onChanged` - nothing
 * fires when a value under a key is overwritten, and the memory page never
 * opens the database directly anyway; only the background worker does, through
 * the conversation's storage addon. So there is nothing to subscribe to on the
 * database. What exists instead is a moment we already know about: every write
 * happens through a handful of call sites in this codebase, all of which can
 * say so.
 *
 * `BroadcastChannel` carries that announcement to any open extension page
 * without needing to know whether one is listening - unlike
 * `browser.runtime.sendMessage`, which is what a page uses to ask the worker
 * something and expects an answer to. This is the reverse direction and there
 * is no answer to wait for, so a broadcast fits it better than a message.
 */
const CHANNEL_NAME = 'companion-memory-changed';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Call after any write completes: a turn closing, a forget, closing a scope. */
export function announceMemoryChanged(): void {
  getChannel().postMessage({ at: Date.now() });
}

/** Subscribe from a page. Returns a function that stops listening. */
export function onMemoryChanged(handler: () => void): () => void {
  const target = getChannel();
  const listener = () => handler();
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
}
