/**
 * Which conversation belongs to a tab, across a browser restart.
 *
 * Chrome reassigns every tab id on restore, so a conversation keyed on one is
 * unreachable afterwards. Nothing plantable survives either: measured in Brave,
 * `sessionStorage`, `history.state` and `window.name` all came back empty, and
 * only `localStorage` lived, which is per-origin and cannot separate two tabs.
 *
 * `history.length` does survive, because restoring a session restores the
 * back/forward stack. So a tab is recognised by what is observably true of it:
 * its url (required), its history depth, and its position in the strip. Depth
 * outranks position, since closing a tab shifts every later index and a
 * duplicated tab carries the original's depth.
 *
 * Recognition runs once per tab per session; the tab id holds the binding after
 * that, so nothing that later resembles a tab can take its conversation.
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
 * short enough that a tab which will never have either - a browser page - is
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
  /** `history.length` - how many steps the tab took to arrive. */
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
   * both mint - leaving two conversations for one tab with identical
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

    // Look twice before giving up on describing the tab.
    let print = await this.describe(tabId);

    if (!print || print.depth === null) {
      await pause(SETTLE_MS);
      print = (await this.describe(tabId)) ?? print;
    }

    // Nothing observable, so nothing to recognise it by - and deliberately not remembered.
    if (!print) return `ephemeral-${tabId}`;

    const claimed = new Set(this.map.values());
    const matched = this.recognise(print, claimed);

    // A missing depth is not a reason to refuse the tab a real name.
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

    // A tab with no binding yet is resolved here rather than skipped.
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
    // Loaded first so the count is the truth.
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
   * Requiring all three would refuse most genuine recoveries - indexes shift
   * constantly - while requiring only the URL would hand a fresh tab somebody
   * else's conversation.
   */
  private recognise(print: TabPrint, claimed: Set<string>): string | null {
    let best: { id: string; score: number; updatedAt: number } | null = null;

    for (const [id, record] of this.records) {
      if (claimed.has(id)) continue;
      if (record.url !== print.url) continue;

      // Depth outranks index.
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
   * is a number rather than anything stored - there is nothing planted in the
   * page and nothing for a site to read back.
   */
  private async askDepth(tabId: number): Promise<number | null> {
    try {
      const reply = await browser.tabs.sendMessage(tabId, { action: ToolAction.TAB_IDENTITY });
      return typeof reply?.depth === 'number' ? reply.depth : null;
    } catch {
      // No content script: a browser page, or a restored tab still discarded.
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
   * and no description was ever recorded - leaving nothing to recognise a tab
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
   * conversation - which also means none of them say anything. This is the way
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
    return `no - ${describeError(error)}`;
  }
}

function mintId(): string {
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
