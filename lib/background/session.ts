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
import { comparePages, fingerprint, type PageComparison } from '../mind/blocks';
import { TabIdentity, scopeNameFor } from './tab-identity';
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

export class SessionManager {
  private convo: Conversation | null = null;
  private loading: Promise<void> | null = null;

  /** Why stored memory is unavailable, or null when it loaded. */
  public storageFailure: string | null = null;
  private settings: ExtensionSettings;

  /**
   * Which conversation each tab is having.
   *
   * Scopes used to be named after the tab id, which Chrome reassigns on every
   * browser restart — so a restored tab found none of its history. This resolves
   * a name that survives one.
   */
  public readonly identity = new TabIdentity();

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
    return convo.scope(await this.scopeNameOf(tabId));
  }

  /** The scope name a tab currently answers to. */
  public async scopeNameOf(tabId: number): Promise<string> {
    return scopeNameFor(await this.identity.conversationFor(tabId));
  }

  /**
   * Make a page the one this tab is looking at.
   *
   * The context pool holds a single node, so writing the new page is what
   * evicts the old one — and the old one does not move across whole, it is cut
   * into pieces on the way to `scraped`. That is the entire lifecycle of a page
   * read, and it is expressed by the mind rather than coded here.
   */
  public async attachPage(tabId: number, page: PageContext): Promise<PageComparison> {
    const scope = await this.scopeFor(tabId);

    // Measured against what is already stored BEFORE this reading is added, or
    // the page would be compared against itself.
    const previous = await this.knownBlocks(page.url ?? '');
    const blocks = fingerprint(page.content ?? '');

    await scope.ensurePool('context').create({
      content: page,
      metadata: { blocks, readAt: Date.now() },
    });
    // `evict()` runs the pool's own policy, which is what enforces the count of
    // one. Creating alone would leave both pages sitting there.
    await scope.evict();

    return comparePages(previous, blocks);
  }

  /**
   * Detach the page from a tab and keep none of it.
   *
   * Deliberately not the eviction path. Replacing a page is a normal part of
   * browsing and the old one is worth chunking into `scraped`; pressing remove
   * says the read was a mistake, and filing a mistake is not what the button
   * appears to offer. `remove` rather than `evict` is the whole difference.
   */
  public async detachPage(tabId: number): Promise<{ removed: boolean }> {
    const convo = await this.ready();
    const resolved = `context:${await this.scopeNameOf(tabId)}`;

    if (!convo.memory.hasPool(resolved)) return { removed: false };

    const pool = convo.memory.pool(resolved);
    const ids = pool.ids();
    for (const id of ids) pool.remove(id);

    if (ids.length) await convo.persist();
    return { removed: ids.length > 0 };
  }

  /**
   * What is already stored for a URL: when it was last read, and its blocks.
   *
   * Reads the fragments rather than a separate index. They already carry the
   * URL they came from and now the fingerprints of the blocks they cover, so
   * the answer is in the store that would otherwise be duplicated to hold it.
   */
  public async pageHistory(url: string): Promise<{ lastReadAt: number | null; blocks: number }> {
    if (!url) return { lastReadAt: null, blocks: 0 };

    const blocks = await this.knownBlocks(url);
    const convo = await this.ready();

    let lastReadAt: number | null = null;

    for (const resolved of convo.memory.pools()) {
      for (const node of convo.memory.pool(resolved).list()) {
        const meta = (node?.metadata ?? {}) as Record<string, unknown>;
        const at = Number(meta.readAt ?? 0);
        if (urlOf(node) !== url || !at) continue;
        if (lastReadAt === null || at > lastReadAt) lastReadAt = at;
      }
    }

    return { lastReadAt, blocks: blocks.length };
  }

  /** Every block fingerprint stored for a URL, from wherever it is held. */
  private async knownBlocks(url: string): Promise<string[]> {
    if (!url) return [];

    const convo = await this.ready();
    const seen = new Set<string>();

    /*
      Both stores are searched. A page read a moment ago is still the attached
      one and has not reached `scraped` yet, so looking only there would report
      a page you just read as never seen.
    */
    for (const resolved of convo.memory.pools()) {
      for (const node of convo.memory.pool(resolved).list()) {
        if (urlOf(node) !== url) continue;
        const stored = (node?.metadata as Record<string, unknown> | undefined)?.blocks;
        if (Array.isArray(stored)) for (const hash of stored) seen.add(String(hash));
      }
    }

    return [...seen];
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
    const resolved = `context:${await this.scopeNameOf(tabId)}`;

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
    const name = await this.scopeNameOf(tabId);

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

/** The URL a node came from, however it happens to record it. */
function urlOf(node: any): string | null {
  return node?.metadata?.pageUrl ?? node?.content?.url ?? null;
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
