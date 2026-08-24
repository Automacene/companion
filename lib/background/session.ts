/**
 * One conversation for the whole browser, one scope per tab.
 *
 * Replaces a Map of independent `VercelConversation` objects, each holding its
 * own message array and character budget. The difference that matters is the
 * archive: every tab writes into one shared memory, so closing a tab does not
 * lose what it learned and another tab can recall it. Memory behaves like
 * browsing history rather than a per-tab transcript.
 *
 * ── The service worker is the only place this can live ─────────
 * A tab closing has to outlive the tab, and `tabs.onRemoved` only fires here.
 * MV3 kills the worker on idle, so `ready()` has to be awaited before anything
 * touches a scope — the pools are empty until IndexedDB has been read back.
 *
 * ── The mind depends on settings ───────────────────────────────
 * Budgets are shares of `num_ctx`, so changing the context window changes the
 * mind. `rebuild()` stands a new one up while keeping what is in storage, which
 * is why the instance is held behind a getter rather than handed out once.
 */
import { Conversation } from '@automacene/conversation';
import { buildMind, buildHooks } from '../mind/build';
import type { PageContext } from './thread';
import type { ExtensionSettings } from '../../types/state';

/** A tab that crashes never fires `onRemoved`, so idle scopes are reaped. */
const SCOPE_IDLE_MS = 6 * 60 * 60 * 1000;

/**
 * How long to wait for stored memory before giving up on it.
 *
 * `indexedDB.open()` fires `onsuccess`, `onerror`, or `onblocked`, and the
 * storage addon only listens for the first two. A blocked open therefore
 * settles nothing at all, and every caller awaiting it waits forever.
 *
 * That is not hypothetical: it wedges the whole worker. `handleUserMessage`
 * awaits the same load, so a hang there means STREAM_COMPLETE never fires and
 * the panel's composer locks; the memory page reports that the worker never
 * answered, because it never did.
 *
 * Starting without stored memory loses history. Hanging loses the extension.
 */
const STORAGE_TIMEOUT_MS = 4000;

export function scopeNameFor(tabId: number): string {
  return `tab:${tabId}`;
}

export class SessionManager {
  private convo: Conversation | null = null;
  private loading: Promise<void> | null = null;

  /** Why stored memory is unavailable, or null when it loaded. */
  public storageFailure: string | null = null;
  private settings: ExtensionSettings;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
  }

  /**
   * The conversation, with storage read back.
   *
   * Every caller awaits this rather than holding the instance, because the
   * worker can be killed between any two messages and the next one has to
   * rehydrate before it can do anything.
   */
  public async ready(): Promise<Conversation> {
    if (!this.convo) this.convo = this.construct();

    if (!this.loading) {
      this.loading = withTimeout(this.convo.load(), STORAGE_TIMEOUT_MS)
        .then(() => {
          this.storageFailure = null;
        })
        .catch((error: unknown) => {
          // Recorded rather than swallowed, so the memory page can say that
          // history is missing because storage failed rather than showing an
          // empty archive as though that were the truth.
          this.storageFailure = error instanceof Error ? error.message : String(error);
          console.warn('[session] could not load stored memory:', error);
        });
    }
    await this.loading;

    return this.convo;
  }

  /** The scope for a tab, created on first mention. */
  public async scopeFor(tabId: number) {
    const convo = await this.ready();
    return convo.scope(scopeNameFor(tabId));
  }

  /**
   * Make a page the one this tab is looking at.
   *
   * The context pool holds a single node, so writing the new page is what
   * evicts the old one — and the old one does not move across whole, it is cut
   * into pieces on the way to `scraped`. That is the entire lifecycle of a page
   * read, and it is expressed by the mind rather than coded here.
   */
  public async attachPage(tabId: number, page: PageContext): Promise<void> {
    const scope = await this.scopeFor(tabId);
    // `evict()` runs the pool's own policy, which is what enforces the count of
    // one. Creating alone would leave both pages sitting there.
    await scope.ensurePool('context').create({ content: page });
    await scope.evict();
  }

  /**
   * The page this tab currently has attached, or null.
   *
   * Returned as title and address only. It is what a turn records, so history
   * can say which page a question was asked against without storing the text a
   * second time — the text is in the pool while it is current and in `scraped`
   * afterwards.
   */
  public async attachedPage(tabId: number): Promise<{ title?: string; url?: string } | null> {
    const convo = await this.ready();
    const name = scopeNameFor(tabId);
    const resolved = `context:${name}`;

    if (!convo.memory.hasPool(resolved)) return null;

    const node = convo.memory.pool(resolved).list().at(-1);
    const page = node?.content;
    if (!page) return null;

    return { title: page.title, url: page.url };
  }

  /**
   * End a tab's conversation.
   *
   * `closeScope` runs each pool's own eviction policy first, so the window,
   * thinking, and actions land in the shared archive before the pools are
   * removed. Nothing is lost unless a pool's disposition is `drop()`.
   */
  public async closeTab(tabId: number): Promise<void> {
    const convo = await this.ready();
    const name = scopeNameFor(tabId);

    if (!convo.hasScope(name)) return;

    try {
      await convo.closeScope(name);
    } catch (error) {
      console.warn(`[session] could not close ${name}:`, error);
    }
  }

  /**
   * Rebuild after a settings change.
   *
   * The mind is derived from `num_ctx` and the memory shares, so those changing
   * means new budgets and new eviction policies. Storage is untouched and read
   * back on the next `ready()`, so nothing is lost — but anything mid-turn is
   * abandoned, which is why this only runs when the numbers actually differ.
   */
  public async applySettings(next: ExtensionSettings): Promise<void> {
    const changed = this.mindWouldChange(next);
    this.settings = next;
    if (!changed) return;

    this.convo = null;
    this.loading = null;
  }

  private mindWouldChange(next: ExtensionSettings): boolean {
    const before = this.settings;
    return (
      before.systemPrompt !== next.systemPrompt ||
      before.modelParams?.num_ctx !== next.modelParams?.num_ctx ||
      JSON.stringify(before.memory) !== JSON.stringify(next.memory)
    );
  }

  private construct(): Conversation {
    return new Conversation({
      mind: buildMind(this.settings),
      hooks: buildHooks(this.settings),
      scopeIdleMs: SCOPE_IDLE_MS,
    });
  }
}

/**
 * Reject rather than wait forever.
 *
 * Written here rather than assumed of the caller because the thing being waited
 * on is a promise that can legitimately never settle, and `await` has no
 * opinion about that.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Stored memory did not load within ${ms}ms. ` +
                'IndexedDB may be blocked or unavailable in this browser profile.',
            ),
          ),
        ms,
      ),
    ),
  ]);
}
