import { splitPoolName } from '@automacene/conversation';
import { MemoryAction } from '../../types/actions';
import { announceMemoryChanged } from './memory-events';
import type { SessionManager } from './session';

/**
 * Reading and pruning the archive from the memory page.
 *
 * The archive is shared by every tab and grows like browsing history, so it
 * needs the same thing browsing history has: a way to see what is in it and
 * remove things. Without that it is a store nobody can inspect, which is a poor
 * bargain when the whole point is that it remembers across tabs.
 *
 * Everything here is read-mostly and deliberately narrow. It can list, search,
 * forget one, and forget all. It cannot edit, because a memory the user rewrote
 * would be indistinguishable from one the model formed.
 */

/** How many entries a listing returns. Search covers the rest. */
const LIST_CAP = 300;

/**
 * Which removable pieces an entry is made of.
 *
 * `query` and `response` are not here on purpose: between them they are the
 * turn, and an entry without either is not a shorter entry, it is a broken one.
 * Removing those means removing the entry.
 */
export type MemoryPartId = 'context' | 'thinking' | 'actions';

/**
 * One piece of an entry, sized so it can be judged before it is removed.
 *
 * The size is the reason this exists. An attached page runs to thousands of
 * characters against a question of maybe sixty, and every one of those
 * characters is indexed for recall — so a turn carrying a page matches far more
 * questions than the exchange alone ever would. None of that was visible.
 */
export interface MemoryPart {
  id: MemoryPartId;
  /** What it is, in the user's words. */
  label: string;
  /** Characters of text, for `context`. */
  chars?: number;
  /** Number of nodes, for `thinking` and `actions`. */
  count?: number;
  /** A one-line description: the page title, or how many items. */
  note: string;
  /** The full text, for the expanded view. */
  detail: string;
}

export interface MemoryEntry {
  id: string;
  /** `turn`, `thinking`, `action`, or `note`. */
  kind: string;
  /** A one-line rendering, whatever the kind. */
  summary: string;
  /** The full stored content, for the expanded view. */
  detail: string;
  createdAt: number;
  /** Present on search results only. */
  score?: number;
  /** Removable pieces this entry holds. Empty for a plain exchange. */
  parts: MemoryPart[];
}

export class MemoryService {
  constructor(private sessions: SessionManager) {}

  public init(): void {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const handler = this.handlerFor(msg?.action);
      if (!handler) return;

      handler(msg)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error: unknown) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Memory request failed',
          });
        });

      return true; // async sendResponse
    });
  }

  private handlerFor(action: string): ((msg: any) => Promise<object>) | null {
    switch (action) {
      case MemoryAction.MEMORY_LIST:
        return () => this.list();
      case MemoryAction.MEMORY_SEARCH:
        return (msg) => this.search(msg.query, msg.target);
      case MemoryAction.MEMORY_FORGET:
        return (msg) => this.forget(msg.id);
      case MemoryAction.MEMORY_FORGET_ALL:
        return () => this.forgetAll();
      case MemoryAction.MEMORY_STATS:
        return () => this.stats();
      case MemoryAction.MEMORY_CLOSE:
        return (msg) => this.close(msg.scope);
      case MemoryAction.MEMORY_FORGET_PART:
        return (msg) => this.forgetPart(msg.id, msg.part);
      default:
        return null;
    }
  }

  private async archive() {
    const convo = await this.sessions.ready();
    return { convo, pool: convo.memory.pool('archive') };
  }

  /** Newest first, because that is the order a history is read in. */
  private async list(): Promise<{ entries: MemoryEntry[]; total: number }> {
    const { convo, pool } = await this.archive();
    const all = pool.list();

    const entries = all
      .slice(-LIST_CAP)
      .reverse()
      .map((node: any) => toEntry(node, convo));

    return { entries, total: all.length };
  }

  /**
   * The same ranking the model gets.
   *
   * Deliberately the same call rather than a separate text match, so what the
   * page shows for a query is what would actually be recalled for it. A search
   * that found things the model could not would be worse than none.
   */
  private async search(
    query: string,
    target?: string,
  ): Promise<{ entries: MemoryEntry[]; total: number }> {
    const convo = await this.sessions.ready();

    /*
      A conversation's own turns, rather than the shared archive.

      The archive only receives a turn once it has aged out or the tab has
      closed, so searching the archive alone cannot find anything said in a
      conversation that is still open — which is exactly the conversation you
      are most likely to be looking for. Searching the scope's window covers it.
    */
    if (target && target !== 'archive') {
      if (!convo.hasScope(target)) return { entries: [], total: 0 };

      const scope = convo.scope(target);
      const resolved = `window:${target}`;

      // A scope can exist with no window pool yet — it is created on the first
      // turn, so a conversation that was opened and never used has none.
      const hits = query?.trim()
        ? await scope.search(query, { pool: 'window', limit: 50 })
        : convo.memory.hasPool(resolved)
          ? convo.memory
              .pool(resolved)
              .list()
              .slice(-LIST_CAP)
              .reverse()
              .map((node: any) => ({ node, score: 0 }))
          : [];

      return {
        entries: hits.map((hit: any) => ({
          ...toEntry(hit.node, convo),
          ...(query?.trim() ? { score: round(hit.score) } : {}),
        })),
        total: hits.length,
      };
    }

    if (!query?.trim()) return this.list();

    const hits = await convo.scope('memory-page').search(query, { pool: 'archive', limit: 50 });

    return {
      entries: hits.map((hit: any) => ({ ...toEntry(hit.node, convo), score: round(hit.score) })),
      total: hits.length,
    };
  }

  /**
   * Finish a conversation by hand.
   *
   * `closeScope` runs each pool's own eviction first, so the turns move into
   * the shared archive instead of being discarded — this ends a conversation,
   * it does not delete it. A crashed tab is the case that needs it: no
   * `onRemoved` ever fires for one, so its turns stay locked in a scope that
   * nothing will ever read again.
   */
  private async close(scope: string): Promise<{ closed: boolean }> {
    const convo = await this.sessions.ready();
    if (!scope || !convo.hasScope(scope)) return { closed: false };

    await convo.closeScope(scope);
    announceMemoryChanged();
    return { closed: true };
  }

  /**
   * Drop one entry, from whichever pool actually holds it.
   *
   * This used to only look in the archive, which was correct as long as the
   * page only ever listed the archive. Now that a conversation's own turns can
   * be searched and shown with the same "Forget this" button, an id can just as
   * easily live in a live tab's window pool — `unregister` finds it in any
   * scope instead of the button silently doing nothing outside the archive.
   */
  private async forget(id: string): Promise<{ removed: boolean }> {
    const convo = await this.sessions.ready();
    const removed = convo.unregister(id);
    if (removed) announceMemoryChanged();
    return { removed };
  }

  /**
   * Remove one piece of an entry and leave the rest of it stored.
   *
   * The re-indexing is the part that matters and the part that is easy to get
   * wrong. Recall runs on keywords extracted from a node's whole content, and
   * the extractor walks nested objects — so an attached page contributes every
   * word it contains to what that turn matches. Deleting the page text without
   * rebuilding the index would leave the turn answering questions about a page
   * it no longer holds, which is worse than not deleting it at all: the entry
   * would still surface, now with nothing to justify why.
   *
   * `pool.update()` handles this. Passing `content` without `tags` clears the
   * node's tags, and `_index` re-derives them from what is left.
   */
  private async forgetPart(id: string, part: MemoryPartId): Promise<{ removed: boolean }> {
    const convo = await this.sessions.ready();

    const pool = poolHolding(convo, id);
    if (!pool) return { removed: false };

    const node = pool.get(id);
    if (!node) return { removed: false };

    const content = { ...(node.content ?? {}) };
    const metadata = { ...(node.metadata ?? {}) };

    if (part === 'context') {
      if (content.context === undefined) return { removed: false };
      delete content.context;
      await pool.update(id, { content });
    } else {
      const ids: string[] = Array.isArray(metadata[part]) ? metadata[part] : [];
      if (ids.length === 0) return { removed: false };

      // The referenced nodes are the actual text; the turn only points at them.
      // Both ends go, or the pointers dangle and the text is orphaned.
      for (const nodeId of ids) convo.unregister(nodeId);
      await pool.update(id, { content, metadata: { ...metadata, [part]: [] } });
    }

    announceMemoryChanged();
    return { removed: true };
  }

  private async forgetAll(): Promise<{ removed: number }> {
    const { pool } = await this.archive();
    const ids = pool.ids();
    for (const id of ids) pool.remove(id);
    if (ids.length) announceMemoryChanged();
    return { removed: ids.length };
  }

  /**
   * What is stored, grouped the way a person thinks about it.
   *
   * This used to return one flat list of pool names. Because the window,
   * thinking, action, and thread pools are all scoped per tab, the page showed
   * "OPEN CONVERSATION" four times with no way to tell which was which — the
   * scope was in the resolved pool name and was being thrown away when the
   * label was made. `splitPoolName` puts it back.
   *
   * Conversations and shared memory are separated because they answer different
   * questions. The archive is what the companion knows; a conversation is one
   * thread that is still going. Mixing them in one grid meant neither was
   * legible.
   */
  private async stats(): Promise<MemoryStats> {
    const convo = await this.sessions.ready();

    const shared: PoolCount[] = [];
    const byScope = new Map<string, Record<string, number>>();

    for (const resolved of convo.memory.pools()) {
      const { base, scope } = splitPoolName(convo.mind, resolved);
      const size = convo.memory.pool(resolved).size;

      if (!scope) {
        shared.push({ name: base, size });
        continue;
      }

      const counts = byScope.get(scope) ?? {};
      counts[base] = size;
      byScope.set(scope, counts);
    }

    /*
      Whether the tab is still there.

      A tab that crashed never fires `onRemoved`, so its conversation stays open
      holding turns nothing can recall. Asking the browser for the tab is the
      only way to tell that apart from a conversation you simply have not
      touched in a while, and it is what makes the close button meaningful.
    */
    const conversations: ConversationStat[] = [];

    for (const [scope, counts] of byScope) {
      const tabId = scope.startsWith('tab:') ? Number(scope.slice(4)) : NaN;
      let title: string | null = null;
      let live = false;

      if (Number.isFinite(tabId)) {
        try {
          const tab = await browser.tabs.get(tabId);
          live = true;
          title = tab.title ?? tab.url ?? null;
        } catch {
          // Gone. That is the answer, not an error.
          live = false;
        }
      }

      conversations.push({
        scope,
        title,
        live,
        turns: counts.window ?? 0,
        thinking: counts.thinking ?? 0,
        actions: counts.action ?? 0,
        indexed: counts.thread ?? 0,
      });
    }

    // Abandoned first: they are the ones with something to decide about.
    conversations.sort((a, b) => Number(a.live) - Number(b.live));

    return {
      // Reported rather than hidden. Without it, memory that failed to load
      // looks exactly like memory that was never written.
      storageFailure: this.sessions.storageFailure,
      shared,
      conversations,
    };
  }
}

/** A pool that belongs to no conversation — the archive and the tool list. */
export interface PoolCount {
  name: string;
  size: number;
}

/** One conversation, with the counts that describe it. */
export interface ConversationStat {
  /** The scope name, `tab:412`. Pass this to close it. */
  scope: string;
  /** The tab's title, when the tab still exists. */
  title: string | null;
  /** Whether the tab is still open. False means it crashed or was lost. */
  live: boolean;
  turns: number;
  thinking: number;
  actions: number;
  indexed: number;
}

export interface MemoryStats {
  storageFailure: string | null;
  shared: PoolCount[];
  conversations: ConversationStat[];
}

/**
 * A stored node as the page shows it. Kinds render differently.
 *
 * `convo` is optional because only turns need it, and only to resolve the
 * thinking and action ids into something worth showing. A node listed without
 * one still renders, just without those parts.
 */
function toEntry(node: any, convo?: any): MemoryEntry {
  const content = node?.content ?? {};
  const metadata = node?.metadata ?? {};
  const createdAt = Number(metadata.createdAt ?? 0);

  if (content.query !== undefined) {
    return {
      id: node.id,
      kind: 'turn',
      summary: String(content.query || '(no question)'),
      detail: `Asked: ${content.query ?? ''}\n\nAnswered: ${content.response ?? '(no answer recorded)'}`,
      createdAt,
      parts: partsOf(content, metadata, convo),
    };
  }

  if (content.tool !== undefined) {
    return {
      id: node.id,
      kind: 'action',
      summary: `${content.tool}(${JSON.stringify(content.params ?? {})})`,
      detail: JSON.stringify(content, null, 2),
      createdAt,
      parts: [],
    };
  }

  if (content.text !== undefined) {
    return {
      id: node.id,
      kind: typeof content.text === 'string' && content.text.length > 0 ? 'thinking' : 'note',
      summary: String(content.text).slice(0, 200),
      detail: String(content.text),
      createdAt,
      parts: [],
    };
  }

  const raw = JSON.stringify(content);
  return {
    id: node.id,
    kind: 'note',
    summary: raw.slice(0, 200),
    detail: raw,
    createdAt,
    parts: [],
  };
}

/** The removable pieces a turn is carrying, sized. */
function partsOf(content: any, metadata: any, convo?: any): MemoryPart[] {
  const parts: MemoryPart[] = [];

  const page = content.context;
  if (page && typeof page === 'object') {
    const text = typeof page.content === 'string' ? page.content : '';
    parts.push({
      id: 'context',
      label: 'page',
      chars: text.length,
      note: page.title || page.url || 'an attached page',
      detail: [page.title, page.url, '', text].filter((line) => line != null).join('\n'),
    });
  }

  // Thinking and actions live as their own nodes in their own pools; the turn
  // only holds their ids. Resolving them is what makes the size meaningful.
  for (const [id, label, ids] of [
    ['thinking', 'reasoning', metadata.thinking],
    ['actions', 'tool results', metadata.actions],
  ] as const) {
    if (!Array.isArray(ids) || ids.length === 0) continue;

    const bodies = ids
      .map((nodeId: string) => {
        const found = convo?.get?.(nodeId);
        if (!found) return null;
        return typeof found.text === 'string' ? found.text : JSON.stringify(found, null, 2);
      })
      .filter((body: string | null): body is string => typeof body === 'string');

    parts.push({
      id,
      label,
      count: ids.length,
      note: `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`,
      detail: bodies.length > 0 ? bodies.join('\n\n---\n\n') : '(no longer stored)',
    });
  }

  return parts;
}

/**
 * The pool holding an id, across every scope.
 *
 * The library has this internally but does not expose it, and `unregister` —
 * which does use it — only removes whole nodes. Editing one needs the pool
 * itself, so the walk is repeated here. Ids are unique across pools, so the
 * first hit is the only hit.
 */
function poolHolding(convo: any, id: string): any | null {
  for (const name of convo.memory.pools()) {
    const pool = convo.memory.pool(name);
    if (pool.has(id)) return pool;
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
