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
import type { ExtensionSettings } from '../../types/state';

/** A tab that crashes never fires `onRemoved`, so idle scopes are reaped. */
const SCOPE_IDLE_MS = 6 * 60 * 60 * 1000;

export function scopeNameFor(tabId: number): string {
  return `tab:${tabId}`;
}

export class SessionManager {
  private convo: Conversation | null = null;
  private loading: Promise<void> | null = null;
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
      this.loading = this.convo
        .load()
        .then(() => undefined)
        .catch((error: unknown) => {
          // An unreadable store is not a reason to refuse to run. Starting
          // empty loses history; throwing here would lose the extension.
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
