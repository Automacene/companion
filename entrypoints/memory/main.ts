/**
 * The memory page.
 *
 * The archive is shared by every tab and grows like browsing history, and until
 * now nothing could see into it. That made a fair question — "why did it not
 * remember that?" — impossible to answer, and gave no way to remove something
 * you would rather it did not keep.
 *
 * Search here runs the same ranking the model does, deliberately. A search that
 * found things the model could not recall would be worse than no search,
 * because it would make the archive look like it was working when it was not.
 */
import '../../styles/index.css';
import './memory.css';

import { startAppearance } from '../../lib/appearance';
import { readSettings } from '../../lib/settings-client';
import { MemoryAction } from '../../types/actions';
import type { MemoryEntry } from '../../lib/background/memory';

async function ask(action: string, payload: object = {}): Promise<any> {
  try {
    const response = await browser.runtime.sendMessage({ action, ...payload });
    if (!response?.success) throw new Error(response?.error ?? 'No response');
    return response;
  } catch (error) {
    console.error('[memory]', error);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await readSettings();
  startAppearance(settings, { backdropContainer: document.getElementById('backdrop-layer') });

  const hub = document.getElementById('open-hub') as HTMLAnchorElement | null;
  if (hub) hub.href = browser.runtime.getURL('/options.html');

  const listHost = document.getElementById('memory-list');
  const statsHost = document.getElementById('memory-stats');
  const search = document.getElementById('memory-search') as HTMLInputElement | null;

  async function refreshStats(): Promise<void> {
    if (!statsHost) return;
    const result = await ask(MemoryAction.MEMORY_STATS);
    statsHost.replaceChildren();

    const pools: { name: string; size: number }[] = result?.pools ?? [];
    if (pools.length === 0) {
      statsHost.appendChild(note('Nothing stored yet.'));
      return;
    }

    for (const pool of pools) {
      const cell = document.createElement('div');
      cell.className = 'memory-page__stat';

      const key = document.createElement('span');
      key.className = 'memory-page__stat-key';
      // Pool names carry their scope, so `window:tab:412` becomes a readable
      // "this tab's conversation" rather than an internal identifier.
      key.textContent = labelForPool(pool.name);

      const value = document.createElement('span');
      value.className = 'memory-page__stat-value';
      value.textContent = String(pool.size);

      cell.append(key, value);
      statsHost.appendChild(cell);
    }
  }

  async function refreshList(): Promise<void> {
    if (!listHost) return;

    const query = search?.value.trim() ?? '';
    const result = query
      ? await ask(MemoryAction.MEMORY_SEARCH, { query })
      : await ask(MemoryAction.MEMORY_LIST);

    const entries: MemoryEntry[] = result?.entries ?? [];
    listHost.replaceChildren();

    if (entries.length === 0) {
      listHost.appendChild(
        note(
          query
            ? 'Nothing matches those words. Recall is keyword matching, so a memory only comes back when the question shares words with it.'
            : 'The archive is empty. It fills when a conversation grows past its budget, or when you close a tab.'
        )
      );
      return;
    }

    for (const entry of entries) listHost.appendChild(row(entry, refresh));
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshStats(), refreshList()]);
  }

  search?.addEventListener('input', debounce(refreshList, 200));

  document.getElementById('forget-all')?.addEventListener('click', async () => {
    // Deliberately blunt. This is the one irreversible control on the page, and
    // it should feel like it.
    if (!confirm('Forget everything in the archive? This cannot be undone.')) return;
    await ask(MemoryAction.MEMORY_FORGET_ALL);
    await refresh();
  });

  await refresh();
});

function row(entry: MemoryEntry, onChange: () => void): HTMLElement {
  const wrap = document.createElement('details');
  wrap.className = 'memory-page__entry';

  const summary = document.createElement('summary');
  summary.className = 'memory-page__entry-summary';

  const kind = document.createElement('span');
  kind.className = `memory-page__kind memory-page__kind--${entry.kind}`;
  kind.textContent = entry.kind;

  const text = document.createElement('span');
  text.className = 'memory-page__entry-text';
  text.textContent = entry.summary;

  const meta = document.createElement('span');
  meta.className = 'memory-page__entry-meta ac-mono';
  meta.textContent =
    entry.score !== undefined
      ? `${Math.round(entry.score * 100)}% match`
      : entry.createdAt
        ? new Date(entry.createdAt).toLocaleDateString()
        : '';

  summary.append(kind, text, meta);

  const body = document.createElement('div');
  body.className = 'memory-page__entry-body';

  const detail = document.createElement('pre');
  detail.className = 'memory-page__entry-detail';
  detail.textContent = entry.detail;

  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'ac-btn ac-btn--ghost';
  forget.textContent = 'Forget this';
  forget.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ action: MemoryAction.MEMORY_FORGET, id: entry.id });
    onChange();
  });

  body.append(detail, forget);
  wrap.append(summary, body);
  return wrap;
}

/** `window:tab:412` is an internal name; this is what it means. */
function labelForPool(name: string): string {
  if (name === 'archive') return 'Archive (shared)';
  if (name === 'tools') return 'Tools';
  if (name.startsWith('window')) return 'Open conversation';
  if (name.startsWith('thinking')) return 'Reasoning';
  if (name.startsWith('action')) return 'Tool results';
  if (name.startsWith('thread')) return 'Scrollback index';
  return name;
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'ac-field__hint memory-page__empty';
  element.textContent = text;
  return element;
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}
