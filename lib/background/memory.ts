import { MemoryAction } from '../../types/actions';
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
        return (msg) => this.search(msg.query);
      case MemoryAction.MEMORY_FORGET:
        return (msg) => this.forget(msg.id);
      case MemoryAction.MEMORY_FORGET_ALL:
        return () => this.forgetAll();
      case MemoryAction.MEMORY_STATS:
        return () => this.stats();
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
    const { pool } = await this.archive();
    const all = pool.list();

    const entries = all
      .slice(-LIST_CAP)
      .reverse()
      .map((node: any) => toEntry(node));

    return { entries, total: all.length };
  }

  /**
   * The same ranking the model gets.
   *
   * Deliberately the same call rather than a separate text match, so what the
   * page shows for a query is what would actually be recalled for it. A search
   * that found things the model could not would be worse than none.
   */
  private async search(query: string): Promise<{ entries: MemoryEntry[]; total: number }> {
    if (!query?.trim()) return this.list();

    const { convo } = await this.archive();
    const hits = await convo.scope('memory-page').search(query, { pool: 'archive', limit: 50 });

    return {
      entries: hits.map((hit: any) => ({ ...toEntry(hit.node), score: round(hit.score) })),
      total: hits.length,
    };
  }

  private async forget(id: string): Promise<{ removed: boolean }> {
    const { pool } = await this.archive();
    // `remove` rather than `evict`: eviction runs the pool's disposition, and
    // the archive's disposition is where things go TO. Forgetting must end here.
    return { removed: pool.remove(id) };
  }

  private async forgetAll(): Promise<{ removed: number }> {
    const { pool } = await this.archive();
    const ids = pool.ids();
    for (const id of ids) pool.remove(id);
    return { removed: ids.length };
  }

  private async stats(): Promise<{ pools: { name: string; size: number }[] }> {
    const convo = await this.sessions.ready();
    return {
      pools: convo.memory
        .pools()
        .map((name: string) => ({ name, size: convo.memory.pool(name).size }))
        .filter((p: { size: number }) => p.size > 0),
    };
  }
}

/** A stored node as the page shows it. Kinds render differently. */
function toEntry(node: any): MemoryEntry {
  const content = node?.content ?? {};
  const createdAt = Number(node?.metadata?.createdAt ?? 0);

  if (content.query !== undefined) {
    return {
      id: node.id,
      kind: 'turn',
      summary: String(content.query || '(no question)'),
      detail: `Asked: ${content.query ?? ''}\n\nAnswered: ${content.response ?? '(no answer recorded)'}`,
      createdAt,
    };
  }

  if (content.tool !== undefined) {
    return {
      id: node.id,
      kind: 'action',
      summary: `${content.tool}(${JSON.stringify(content.params ?? {})})`,
      detail: JSON.stringify(content, null, 2),
      createdAt,
    };
  }

  if (content.text !== undefined) {
    return {
      id: node.id,
      kind: typeof content.text === 'string' && content.text.length > 0 ? 'thinking' : 'note',
      summary: String(content.text).slice(0, 200),
      detail: String(content.text),
      createdAt,
    };
  }

  const raw = JSON.stringify(content);
  return { id: node.id, kind: 'note', summary: raw.slice(0, 200), detail: raw, createdAt };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
