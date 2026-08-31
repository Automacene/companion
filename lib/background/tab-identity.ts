/**
 * Which conversation belongs to a tab, across a browser restart.
 *
 * Conversations were keyed on the tab id, and Chrome's documentation says
 * plainly that "Tab IDs are unique within a browser session". Restoring a
 * session hands every tab a new id, so the conversation, the attached page, and
 * the panel's scrollback were all still on disk under a name nothing would ever
 * ask for again — and a fresh set was stranded on every restart, re-serialized
 * into every save from then on.
 *
 * ── What actually survives, measured ───────────────────────────
 *
 * Nothing on a `Tab` does. `id`, `index`, `windowId` and `groupId` are
 * reassigned, `openerTabId` points at another reassigned id, `sessionId` is only
 * populated on tabs from the `sessions` API, and there is no creation timestamp.
 *
 * Planting a marker in the page was the obvious next idea and it does not work
 * either. Tested in Brave across a real restart with session restore on:
 * `sessionStorage`, `history.state` and `window.name` all came back empty. Only
 * `localStorage` survived, and that is per-origin rather than per-tab, so it
 * cannot tell two tabs on one site apart.
 *
 * What did survive is `history.length`. It is not stored data but the depth of
 * the tab's own back/forward stack, and restoring a session restores that stack
 * — the back button still works afterwards. Measured at four before a restart
 * and four after.
 *
 * ── So a tab is recognised, not labelled ───────────────────────
 *
 * There is no id to carry, so a tab is identified by what is observably true of
 * it: the page it is on, how many steps it took to get there, and where it sits
 * in the strip. The extension keeps that description in its own storage, so
 * nothing is written into anybody's page and no site can read anything back.
 *
 * URL is required — matching without it would hand a tab a conversation about a
 * different page. Depth and index then score the candidates, because neither
 * works alone: closing a tab shifts every index after it, and duplicating a tab
 * produces a copy carrying the same depth. Between them they separate the cases
 * that matter, and a duplicate is caught by index precisely because the depth
 * comes along with the clone.
 *
 * ── Recognised once, then held ─────────────────────────────────
 *
 * Recognition only runs for a tab this session has not seen. After that the tab
 * id holds the binding in `storage.session` — documented as in-memory and never
 * persisted, so it survives the worker being collected and is empty again after
 * a restart, which is exactly when recognition should run again. A tab that
 * later comes to resemble another cannot take its conversation, because by then
 * nothing is looking.
 */
import { ToolAction } from '../../types/actions';

/** The in-session binding: tab id to conversation. Cleared on restart. */
const MAP_KEY = 'companion-tab-conversations';

/** The durable descriptions used to recognise a tab after a restart. */
const RECOVERY_KEY = 'companion-conversation-recovery';

/**
 * How many descriptions to keep.
 *
 * One per conversation ever had, otherwise. They are small, but they are
 * rewritten on every navigation, so the list is capped and the least recently
 * seen fall off.
 */
const MAX_RECORDS = 300;

/**
 * How long to wait before looking at a tab a second time.
 *
 * Long enough for a restored tab to have a url and a running content script,
 * short enough that a tab which will never have either — a browser page — is
 * not held up noticeably.
 */
const SETTLE_MS = 400;

/** Scope names, so a conversation is never confused with a tab id. */
export function scopeNameFor(conversationId: string): string {
  return `convo:${conversationId}`;
}

/** What a tab looked like when it was last seen. */
export interface RecoveryRecord {
  url: string;
  /** `history.length` — how many steps the tab took to arrive. */
  depth: number;
  /** Position in the tab strip. */
  index: number;
  updatedAt: number;
}

/** What can be observed about a tab right now. */
interface TabPrint {
  url: string;
  depth: number | null;
  index: number;
}

export class TabIdentity {
  private map = new Map<number, string>();
  private records = new Map<string, RecoveryRecord>();
  private loaded = false;

  /** The last thing that went wrong, for `debug()`. */
  private trouble: string | null = null;

  /** Resolutions already running, so one tab is never recognised twice at once. */
  private pending = new Map<number, Promise<string>>();

  /**
   * The conversation a tab is having, recognising it if this session has not
   * seen the tab before.
   *
   * Resolutions for one tab are shared rather than run twice. Recognition is
   * several awaits long and the panel asks for history and page status back to
   * back, so two calls would both find no binding, both fail to recognise, and
   * both mint — leaving two conversations for one tab with identical
   * descriptions, and the second quietly displacing the first. That is not
   * hypothetical: it is what the stored records showed, in pairs stamped with
   * the same millisecond.
   */
  public conversationFor(tabId: number): Promise<string> {
    const inFlight = this.pending.get(tabId);
    if (inFlight) return inFlight;

    const resolving = this.resolve(tabId).finally(() => this.pending.delete(tabId));
    this.pending.set(tabId, resolving);
    return resolving;
  }

  private async resolve(tabId: number): Promise<string> {
    await this.load();

    const bound = this.map.get(tabId);
    if (bound) return bound;

    /*
      Look twice before giving up on describing the tab.

      Opening the sidepanel asks about the active tab straight away, and after a
      browser restart that lands on a tab that is still coming back: no url on
      it yet, or no content script to report its depth. One badly timed question
      would otherwise decide the tab's identity for the whole session, and
      nothing would ask again — which is precisely what happens when the panel
      is not already open when the browser starts, since opening it IS the one
      question.

      A restored tab settles in well under a second, so a short second look
      costs nothing on a tab that was ready and rescues the one that was not.
    */
    let print = await this.describe(tabId);

    if (!print || print.depth === null) {
      await pause(SETTLE_MS);
      print = (await this.describe(tabId)) ?? print;
    }

    /*
      Nothing observable, so nothing to recognise it by — and deliberately not
      remembered. A tab is unreachable while it is still discarded, which is
      exactly the state a restored tab is in until you click it. Caching that
      answer would fix a tab's identity from the one moment it could not
      answer, which is how the previous attempt at this failed.
    */
    if (!print) return `ephemeral-${tabId}`;

    const claimed = new Set(this.map.values());
    const matched = this.recognise(print, claimed);

    /*
      A missing depth is not a reason to refuse the tab a real name.

      This used to return an ephemeral name whenever no match was found and the
      depth was unknown, on the theory that the question had come too early. The
      settle above covers that case now, and the theory was wrong about the one
      that matters: reloading the extension does not inject content scripts into
      tabs that are already open, so every tab from before the reload has no
      content script until it is reloaded itself. That is permanent, not
      transient, and the old rule left those tabs ephemeral forever.

      Which would be tolerable if the name were only a name. It is not — it
      becomes the scope the conversation is stored under, so every turn was
      being written to `convo:ephemeral-<tabId>`, a name built from the one
      thing guaranteed not to survive a restart. The conversation was doomed as
      it was saved, and no amount of recognition afterwards could have found it.

      A tab with a url and a position is describable enough to keep. Depth
      missing only means it is recognised on the other two.
    */
    const conversationId = matched ?? mintId();

    this.map.set(tabId, conversationId);
    this.remember(conversationId, print);
    await this.save();

    return conversationId;
  }

  /**
   * Refresh what a tab looks like, so it is recognised where it is now.
   *
   * Called as a tab navigates. Without it the description would still be the
   * page the conversation started on, and a restored tab sitting three links
   * further along would match nothing.
   */
  public async note(tabId: number): Promise<void> {
    await this.load();

    /*
      A tab with no binding yet is resolved here rather than skipped.

      This is the retry that makes recognition work at all when the sidepanel is
      not already open. Opening it asks about the active tab exactly once, and
      on a freshly restored tab that ask lands while the page is still loading —
      no url on the tab yet, no content script to report a depth — so the tab
      gets a name good for that moment and the panel renders nothing. Without a
      second attempt after the page settles, one badly timed question decided
      the whole thing.
    */
    const conversationId = this.map.get(tabId);
    if (!conversationId) {
      await this.conversationFor(tabId);
      return;
    }

    const print = await this.describe(tabId);
    if (!print) return;

    this.remember(conversationId, print);
    await this.save();
  }

  /**
   * Throw away every binding and description, in memory and on disk.
   *
   * Clearing the store by hand does not work while the worker is alive, and the
   * failure is quiet enough to waste an afternoon: `load` reads once and the
   * in-memory copy is authoritative from then on, so a wiped store still reads
   * back as full and the next save writes all of it out again. Anything that
   * clears this has to clear both halves, which is why it is a method rather
   * than something to do from the console.
   */
  public async reset(): Promise<{ cleared: number }> {
    // Loaded first so the count is the truth. On a worker that has only just
    // started nothing has been read yet, so this reported clearing nothing
    // while removing a full store.
    await this.load();
    const cleared = this.records.size;

    this.map.clear();
    this.records.clear();
    this.pending.clear();
    this.trouble = null;
    this.loaded = true;

    try {
      await browser.storage.session.remove(MAP_KEY);
    } catch {
      // Nothing to do about it, and the in-memory half is already empty.
    }

    try {
      await browser.storage.local.remove(RECOVERY_KEY);
    } catch (error) {
      this.trouble = `could not clear recovery store: ${describeError(error)}`;
    }

    return { cleared };
  }

  /** Forget a tab. Its conversation and its description both remain. */
  public async forget(tabId: number): Promise<void> {
    await this.load();
    if (!this.map.delete(tabId)) return;
    await this.save();
  }

  /** The live tab currently having a conversation, if any. */
  public async tabFor(conversationId: string): Promise<number | null> {
    await this.load();
    for (const [tabId, id] of this.map) if (id === conversationId) return tabId;
    return null;
  }

  /**
   * The best unclaimed conversation for a tab, or null to start a new one.
   *
   * URL has to match; the rest is scored. A tab whose page, depth and position
   * all agree is almost certainly the tab that was there before, and each
   * signal that disagrees weakens the claim without necessarily breaking it.
   * Requiring all three would refuse most genuine recoveries — indexes shift
   * constantly — while requiring only the URL would hand a fresh tab somebody
   * else's conversation.
   */
  private recognise(print: TabPrint, claimed: Set<string>): string | null {
    let best: { id: string; score: number; updatedAt: number } | null = null;

    for (const [id, record] of this.records) {
      if (claimed.has(id)) continue;
      if (record.url !== print.url) continue;

      /*
        Depth outranks index. Depth says how the tab got here, which an
        unrelated tab on the same page rarely shares; index shifts whenever any
        earlier tab is closed. The one case index decides is a duplicated tab,
        which arrives carrying the original's depth and can only be told apart
        by where it sits.
      */
      let score = 1;
      if (print.depth !== null && record.depth === print.depth) score += 2;
      if (record.index === print.index) score += 1;

      const better =
        !best || score > best.score || (score === best.score && record.updatedAt > best.updatedAt);

      if (better) best = { id, score, updatedAt: record.updatedAt };
    }

    return best?.id ?? null;
  }

  /**
   * Update a conversation's description, without letting a gap erase a fact.
   *
   * `note` runs on navigation, and a page part way through loading has no
   * content script to answer with its depth. Writing the missing value would
   * replace a known depth with a zero, which is worse than not updating at all:
   * the strongest of the three signals is gone and every later recognition
   * falls back to matching on the URL alone. Two of the stored records had been
   * flattened this way.
   */
  private remember(conversationId: string, print: TabPrint): void {
    const previous = this.records.get(conversationId);

    this.records.set(conversationId, {
      url: print.url,
      depth: print.depth ?? previous?.depth ?? 0,
      index: print.index,
      updatedAt: Date.now(),
    });
  }

  /** What is observable about a tab, or null when it cannot be reached. */
  private async describe(tabId: number): Promise<TabPrint | null> {
    let tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      return null;
    }

    if (!tab.url) return null;

    return { url: tab.url, depth: await this.askDepth(tabId), index: tab.index };
  }

  /**
   * How deep the tab's history is, asked of the page.
   *
   * `history.length` is a page API, so only the content script can read it. It
   * is a number rather than anything stored — there is nothing planted in the
   * page and nothing for a site to read back.
   */
  private async askDepth(tabId: number): Promise<number | null> {
    try {
      const reply = await browser.tabs.sendMessage(tabId, { action: ToolAction.TAB_IDENTITY });
      return typeof reply?.depth === 'number' ? reply.depth : null;
    } catch {
      // No content script: a browser page, or a restored tab still discarded.
      // URL and index alone still recognise it, just less confidently.
      return null;
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const session = await browser.storage.session.get(MAP_KEY);
      const bound = (session?.[MAP_KEY] ?? {}) as Record<string, string>;
      for (const [tabId, id] of Object.entries(bound)) this.map.set(Number(tabId), id);
    } catch (error) {
      this.trouble = `session store unreadable: ${describeError(error)}`;
    }

    try {
      const local = await browser.storage.local.get(RECOVERY_KEY);
      const saved = (local?.[RECOVERY_KEY] ?? {}) as Record<string, RecoveryRecord>;
      for (const [id, record] of Object.entries(saved)) this.records.set(id, record);
    } catch (error) {
      this.trouble = `recovery store unreadable: ${describeError(error)}`;
      console.warn('[tab-identity] could not read recovery records:', error);
    }
  }

  /**
   * Persist both halves, independently.
   *
   * Separate blocks because they have nothing to do with each other and one
   * failing must not take the other down. They shared a `try` and that is
   * exactly what went wrong: `storage.session` is MV3-only and not present
   * everywhere, so when it threw, the `storage.local` write below it never ran
   * and no description was ever recorded — leaving nothing to recognise a tab
   * by, silently, because the catch was empty.
   *
   * Losing the session map costs continuity across a worker restart. Losing the
   * descriptions costs the entire feature. They are not the same stake.
   */
  private async save(): Promise<void> {
    this.prune();

    try {
      await browser.storage.session.set({ [MAP_KEY]: Object.fromEntries(this.map) });
    } catch (error) {
      this.trouble = `session store unavailable: ${describeError(error)}`;
    }

    try {
      await browser.storage.local.set({ [RECOVERY_KEY]: Object.fromEntries(this.records) });
    } catch (error) {
      this.trouble = `recovery store unavailable: ${describeError(error)}`;
      console.warn('[tab-identity] could not save recovery records:', error);
    }
  }

  /**
   * What this currently believes, for the service worker console.
   *
   * Every failure path here is caught, because none of them should break a
   * conversation — which also means none of them say anything. This is the way
   * to find out what it decided and why.
   */
  public async debug(): Promise<object> {
    await this.load();
    return {
      trouble: this.trouble,
      bindings: Object.fromEntries(this.map),
      records: Object.fromEntries(this.records),
      sessionStoreWorks: await probe(() =>
        browser.storage.session.set({ 'companion-probe': Date.now() }),
      ),
      localStoreWorks: await probe(() =>
        browser.storage.local.set({ 'companion-probe': Date.now() }),
      ),
    };
  }

  /** Keep the most recently seen descriptions and drop the rest. */
  private prune(): void {
    if (this.records.size <= MAX_RECORDS) return;

    const ordered = [...this.records.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    this.records = new Map(ordered.slice(0, MAX_RECORDS));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a store can actually be written to right now. */
async function probe(write: () => Promise<unknown>): Promise<string> {
  try {
    await write();
    return 'yes';
  } catch (error) {
    return `no — ${describeError(error)}`;
  }
}

function mintId(): string {
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
