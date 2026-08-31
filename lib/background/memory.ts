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
export type MemoryPartId = 'context';

/** What an entry came from, so one list can carry both and say which is which. */
export type EntrySource = 'conversation' | 'page';

/**
 * How the history list is narrowed.
 *
 * Every field is optional and they compose, which is the point — "pages, from
 * the last day, mentioning pensions" is three filters over one list rather than
 * a view somebody had to think of in advance.
 */
export interface BrowseFilter {
  /** Ranked by the same search the model uses. Empty means chronological. */
  query?: string;
  /** Which store to read. Defaults to both. */
  source?: 'all' | 'conversations' | 'pages';
  /** Only entries at or after this epoch millisecond. */
  since?: number;
  /** One conversation's own turns instead of the shared stores. */
  scope?: string;
}

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
  /** Which store this came from. Shown as a badge and used by the filters. */
  source: EntrySource;
  /** For a page fragment: which page, and where it sat in it. */
  page?: { title: string | null; url: string | null; part: number; of: number };
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
        return (msg) => this.browse(msg.filter ?? {});
      case MemoryAction.MEMORY_FORGET:
        return (msg) => this.forget(msg.ids ?? []);
      case MemoryAction.MEMORY_STATS:
        return () => this.stats();
      case MemoryAction.MEMORY_CLOSE:
        return (msg) => this.close(msg.scope);
      case MemoryAction.MEMORY_FORGET_PART:
        return (msg) => this.forgetPart(msg.id, msg.part);
      case MemoryAction.MEMORY_DELETE_SCOPE:
        return (msg) => this.deleteScope(msg.scope);
      case MemoryAction.MEMORY_PURGE_ORPHANS:
        return () => this.purgeOrphans();
      default:
        return null;
    }
  }

  private async archive() {
    const convo = await this.sessions.ready();
    return { convo, pool: convo.memory.pool('archive') };
  }

  /**
   * One list of everything stored, narrowed by a filter.
   *
   * Built the way a browser history window is, because that is what this is:
   * one list you narrow and pick from, not a menu of separate views with a
   * blunt "delete all of this kind" button on each. Conversations and page
   * fragments appear together, sorted newest first, each saying which it is —
   * so "what did I look at on Tuesday" and "what does it know about pensions"
   * are the same question asked with different filters.
   *
   * With a query the order is relevance, using the same ranking the model gets
   * so that what appears here is genuinely what a question would bring back.
   * Without one it is chronological, which is how you read a history.
   */
  private async browse(filter: BrowseFilter): Promise<{ entries: MemoryEntry[]; total: number }> {
    const convo = await this.sessions.ready();
    const query = filter.query?.trim() ?? '';
    const source = filter.source ?? 'all';

    /*
      One conversation's own turns, when the list is pointed at a scope.

      Its window has not reached the archive yet — that only happens as turns
      age out or the tab closes — so the conversation you are having right now
      is exactly the one the shared stores know nothing about.
    */
    if (filter.scope) {
      if (!convo.hasScope(filter.scope)) return { entries: [], total: 0 };

      const resolved = `window:${filter.scope}`;
      const hits = query
        ? await convo.scope(filter.scope).search(query, { pool: 'window', limit: LIST_CAP })
        : convo.memory.hasPool(resolved)
          ? convo.memory
              .pool(resolved)
              .list()
              .map((node: any) => ({ node, score: undefined }))
          : [];

      return finish(
        hits.map((hit: any) => ({
          ...toEntry(hit.node, convo, 'conversation'),
          score: score(hit),
        })),
        filter,
      );
    }

    const pools: [string, EntrySource][] = [];
    if (source !== 'pages') pools.push(['archive', 'conversation']);
    if (source !== 'conversations') pools.push(['scraped', 'page']);

    const entries: MemoryEntry[] = [];

    for (const [name, kind] of pools) {
      if (!convo.memory.hasPool(name)) continue;

      const hits = query
        ? await convo.scope('memory-page').search(query, { pool: name, limit: LIST_CAP })
        : convo.memory
            .pool(name)
            .list()
            .map((node: any) => ({ node, score: undefined }));

      for (const hit of hits)
        entries.push({ ...toEntry(hit.node, convo, kind), score: score(hit) });
    }

    return finish(entries, filter);
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
   * Forget the given entries, wherever each of them lives.
   *
   * A list rather than one id, because deleting from a history list is a
   * selection. `unregister` finds each wherever it is — the shared archive, the
   * page fragments, or a live tab's window — so the caller never has to know
   * which store a row came from, and a mixed selection needs no special case.
   */
  private async forget(ids: string[]): Promise<{ removed: number }> {
    const convo = await this.sessions.ready();

    let removed = 0;
    for (const id of ids) if (convo.unregister(id)) removed++;

    if (removed) {
      await convo.persist();
      announceMemoryChanged();
    }
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

  /**
   * Delete a conversation and keep none of it.
   *
   * `closeScope` evicts first, and eviction is what moves turns into the
   * archive — so closing preserves. Emptying the scope's own pools beforehand
   * leaves eviction nothing to carry across, and the same call then becomes a
   * deletion. That is the whole trick, and it means this cannot drift out of
   * step with however closing works later.
   *
   * Only the pools this scope owns are touched. Anything of its that already
   * reached the shared archive stays there, because it belongs to the browser
   * now rather than to the tab, and removing it would delete history the user
   * did not point at.
   */
  private async deleteScope(scope: string): Promise<{ deleted: boolean; removed: number }> {
    const convo = await this.sessions.ready();
    if (!scope || !convo.hasScope(scope)) return { deleted: false, removed: 0 };

    let removed = 0;
    for (const resolved of convo.memory.pools()) {
      const { scope: owner } = splitPoolName(convo.mind, resolved);
      if (owner !== scope) continue;

      const pool = convo.memory.pool(resolved);
      for (const id of pool.ids()) {
        pool.remove(id);
        removed++;
      }
    }

    // Now a no-op as far as archiving goes, and it still drops the pools and
    // retires the scope name properly.
    await convo.closeScope(scope);

    announceMemoryChanged();
    return { deleted: true, removed };
  }

  /**
   * Drop every pool the current mind does not declare.
   *
   * These cost a little storage each and, more to the point, are serialized
   * into every save — the whole of memory is written out on each change, so
   * dead pools are paid for on every write forever. Nothing reads them and
   * nothing will, because the names are not in the mind any more.
   */
  private async purgeOrphans(): Promise<{ removed: number; pools: string[] }> {
    const convo = await this.sessions.ready();
    const pools: string[] = [];
    let removed = 0;

    for (const resolved of convo.memory.pools()) {
      const { base } = splitPoolName(convo.mind, resolved);
      if ((convo.mind.pools as Record<string, unknown>)[base]) continue;

      removed += convo.memory.pool(resolved).size;
      convo.memory.dropPool(resolved);
      pools.push(resolved);
    }

    if (pools.length) {
      await convo.persist();
      announceMemoryChanged();
    }
    return { removed, pools };
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
    const orphans: PoolCount[] = [];
    const byScope = new Map<string, Record<string, number>>();

    for (const resolved of convo.memory.pools()) {
      const { base, scope } = splitPoolName(convo.mind, resolved);
      const size = convo.memory.pool(resolved).size;
      const declared = (convo.mind.pools as Record<string, { scoped?: boolean }>)[base];

      /*
        A pool the current mind knows nothing about.

        Storage outlives the mind. Changing which pools exist leaves whatever
        the previous arrangement wrote sitting in IndexedDB under names nothing
        reads any more — `thinking`, `action`, and `tools` after they were
        dropped, and any per-tab pools they had spawned. `splitPoolName` cannot
        even take those apart, because it matches against the mind's own keys,
        so `thinking:tab:9` comes back whole and unattributable.

        They were being counted as shared memory, which put five dead pools in
        the same grid as the archive and made both harder to read.
      */
      if (!declared) {
        orphans.push({ name: resolved, size });
        continue;
      }

      /*
        The library instantiates an unscoped copy of every declared pool for the
        default scope, whether or not the pool is scoped. So `window`, `context`,
        and `thread` each show up with no scope attached, always empty, on every
        single load. They are an artifact of how scopes are rebuilt, not
        somewhere anything is stored, and listing them is noise.
      */
      if (declared.scoped && !scope) continue;

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
      /*
        Which live tab, if any, is having this conversation.

        The scope name used to be the tab id, so this parsed it back out. It is
        a conversation id now — precisely so that it does NOT change when the
        browser reassigns tab ids on a restart — so the live tab is looked up
        through the same map the worker uses to route messages.
      */
      const conversationId = scope.startsWith('convo:') ? scope.slice(6) : scope;
      const tabId = await this.sessions.identity.tabFor(conversationId);

      let title: string | null = null;
      let live = false;

      if (tabId !== null) {
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
        page: counts.context ?? 0,
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
      orphans,
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
  /** The scope name, `convo:c-a1b2c3d4`. Pass this to close it. */
  scope: string;
  /** The tab's title, when the tab still exists. */
  title: string | null;
  /** Whether the tab is still open. False means it crashed or was lost. */
  live: boolean;
  turns: number;
  /** 1 when a page is attached to this tab, 0 otherwise. */
  page: number;
  indexed: number;
}

export interface MemoryStats {
  storageFailure: string | null;
  shared: PoolCount[];
  /** Pools left behind by an older arrangement. Nothing reads these. */
  orphans: PoolCount[];
  conversations: ConversationStat[];
}

/**
 * A stored node as the page shows it. Kinds render differently.
 *
 * `convo` is optional because only turns need it, and only to resolve the
 * thinking and action ids into something worth showing. A node listed without
 * one still renders, just without those parts.
 */
function toEntry(node: any, convo?: any, source: EntrySource = 'conversation'): MemoryEntry {
  const content = node?.content ?? {};
  const metadata = node?.metadata ?? {};
  // `readAt` for a page fragment: it is when the page was read, where
  // `createdAt` is when the fragment was cut, which happens later when the next
  // page displaces it. A history sorted by filing time reads wrong.
  const createdAt = Number(metadata.readAt ?? metadata.createdAt ?? 0);

  /*
    A piece of a page. Its text already opens with the provenance line the
    chunker wrote, so the summary drops that and shows the prose — the title is
    carried alongside and rendered as its own thing.
  */
  if (source === 'page' || metadata.pageTitle !== undefined) {
    const text = String(content.text ?? '');
    const body = text.replace(/^From [^\n]*\n\n/, '');
    return {
      id: node.id,
      kind: 'page',
      source: 'page',
      summary: body.slice(0, 240),
      detail: text,
      createdAt,
      parts: [],
      page: {
        title: metadata.pageTitle ?? null,
        url: metadata.pageUrl ?? null,
        part: Number(metadata.part ?? 1),
        of: Number(metadata.of ?? 1),
      },
    };
  }

  if (content.query !== undefined) {
    return {
      id: node.id,
      kind: 'turn',
      source,
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
      source,
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
      source,
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
    source,
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
/** A hit's score, when there was a query to score against. */
function score(hit: any): number | undefined {
  return typeof hit.score === 'number' ? round(hit.score) : undefined;
}

/**
 * Sort, apply the date filter, and cap.
 *
 * Relevance order when a query produced scores, newest-first otherwise. Both
 * stores are merged before this runs, so a ranked search returns the best
 * matches across conversations and pages together rather than the best of each.
 */
function finish(
  entries: MemoryEntry[],
  filter: BrowseFilter,
): { entries: MemoryEntry[]; total: number } {
  const since = filter.since;
  const kept = since ? entries.filter((entry) => entry.createdAt >= since) : entries;

  kept.sort((a, b) =>
    a.score !== undefined && b.score !== undefined ? b.score - a.score : b.createdAt - a.createdAt,
  );

  return { entries: kept.slice(0, LIST_CAP), total: kept.length };
}

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
