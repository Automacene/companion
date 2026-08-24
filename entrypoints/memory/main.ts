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
import { askWorker } from '../../lib/worker-client';
import { onMemoryChanged } from '../../lib/background/memory-events';
import type { MemoryEntry, PoolCount, ConversationStat } from '../../lib/background/memory';

/**
 * Ask the worker something, and report a failure AS a failure.
 *
 * This used to catch and return null, which the page then rendered through
 * `?? []` — so a request that never reached the worker looked exactly like an
 * empty archive. On a page whose whole job is telling you what is stored, those
 * two must never look the same.
 *
 * The page is opened from a link on the settings hub, so it is very often the
 * thing that wakes the worker up. `askWorker` covers that; see the note there
 * for why a cold worker drops the first message without reporting anything.
 */
async function ask(action: string, payload: object = {}): Promise<any> {
  const response = await askWorker<{ success: boolean; error?: string }>({ action, ...payload });
  if (!response.success) throw new Error(response.error ?? 'The request failed.');
  return response;
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await readSettings();
  startAppearance(settings, { backdropContainer: document.getElementById('backdrop-layer') });

  const hub = document.getElementById('open-hub') as HTMLAnchorElement | null;
  if (hub) hub.href = browser.runtime.getURL('/options.html');

  /*
    The dot reports whether the WORKER answered, not whether Ollama is up.
    Ollama is irrelevant here — this page only reads storage — and a dot that
    sits grey forever because nothing ever sets it is worse than no dot.
  */
  const statusDot = document.getElementById('status-dot');
  const setReachable = (ok: boolean) => {
    if (statusDot) statusDot.className = `ac-status-dot ac-status-dot--${ok ? 'ok' : 'error'}`;
  };

  const listHost = document.getElementById('memory-list');
  const statsHost = document.getElementById('memory-stats');
  const search = document.getElementById('memory-search') as HTMLInputElement | null;

  async function refreshStats(): Promise<void> {
    if (!statsHost) return;

    let result;
    try {
      result = await ask(MemoryAction.MEMORY_STATS);
    } catch (error) {
      setReachable(false);
      statsHost.replaceChildren(
        problem(error instanceof Error ? error.message : 'Could not read memory.'),
      );
      return;
    }

    setReachable(true);
    statsHost.replaceChildren();

    // Storage failing is different from storage being empty, and only one of
    // them means history was lost.
    if (result.storageFailure) {
      statsHost.appendChild(
        problem(`${result.storageFailure} Anything from before this session is not loaded.`),
      );
    }

    /*
      Shared memory first, then conversations.

      These used to be one flat grid of pool names, which printed "OPEN
      CONVERSATION" once per tab with nothing to tell them apart — the window,
      thinking, action, and thread pools are all per-tab, so four tabs produced
      sixteen identically labelled cells. Splitting them by what they belong to
      is the whole difference between a diagnostic dump and a page you can read.
    */
    const shared: PoolCount[] = result.shared ?? [];
    const conversations: ConversationStat[] = result.conversations ?? [];

    if (shared.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'memory-page__stats-grid';

      for (const pool of shared) {
        const cell = document.createElement('div');
        cell.className = 'memory-page__stat';

        const key = document.createElement('span');
        key.className = 'memory-page__stat-key';
        key.textContent = labelForPool(pool.name);

        const value = document.createElement('span');
        value.className = 'memory-page__stat-value';
        value.textContent = String(pool.size);

        cell.append(key, value);
        grid.appendChild(cell);
      }

      statsHost.appendChild(grid);
    }

    if (conversations.length === 0) {
      statsHost.appendChild(
        note('No conversations are open. Send a message in the sidepanel to start one.'),
      );
      return;
    }

    const heading = document.createElement('h3');
    heading.className = 'memory-page__subhead';
    heading.textContent = 'Conversations';
    statsHost.appendChild(heading);

    for (const convo of conversations) {
      statsHost.appendChild(conversationCard(convo, refresh, searchWithin));
    }
  }

  /*
    What the list below is showing.

    'archive' is the shared memory every tab can recall. Anything else is one
    conversation's own turns, which the archive cannot answer for: a turn only
    reaches the archive once it has aged out of its window or the tab has
    closed, so the conversation you are currently having is precisely the one
    the archive knows nothing about.
  */
  let target = 'archive';

  function searchWithin(scope: string): void {
    target = scope;
    if (search) search.value = '';
    void refreshList();
  }

  async function refreshList(): Promise<void> {
    if (!listHost) return;

    const query = search?.value.trim() ?? '';
    const inArchive = target === 'archive';

    let result;
    try {
      result =
        query || !inArchive
          ? await ask(MemoryAction.MEMORY_SEARCH, { query, target })
          : await ask(MemoryAction.MEMORY_LIST);
    } catch (error) {
      listHost.replaceChildren(
        problem(error instanceof Error ? error.message : 'Could not read memory.'),
      );
      return;
    }

    const entries: MemoryEntry[] = result.entries ?? [];
    listHost.replaceChildren();

    // Which memory is being read. Without this the results look like the
    // archive and it is not obvious why the archive suddenly changed.
    if (!inArchive) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'ac-btn ac-btn--ghost memory-page__scope-back';
      back.textContent = `Showing ${target} · back to the shared archive`;
      back.addEventListener('click', () => searchWithin('archive'));
      listHost.appendChild(back);
    }

    if (entries.length === 0) {
      listHost.appendChild(
        note(
          query
            ? 'Nothing matches those words. Recall is keyword matching, so a memory only comes back when the question shares words with it.'
            : inArchive
              ? 'The archive is empty. It fills when a conversation grows past its budget, or when you close a tab.'
              : 'This conversation holds nothing yet.',
        ),
      );
      return;
    }

    for (const entry of entries) listHost.appendChild(row(entry, refresh));
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshStats(), refreshList()]);
  }

  search?.addEventListener('input', debounce(refreshList, 200));

  /*
    Redrawing when storage changes, not only when this page caused it.

    Without this, a second tab finishing a turn — or the panel closing that
    tab and archiving what it held — left the page showing whatever it looked
    like on open until somebody manually reloaded it. IndexedDB has nothing
    like `browser.storage.onChanged` to notice that by itself, so the
    background worker says so directly after every write; see
    `lib/background/memory-events.ts` for why a broadcast rather than a
    message. Debounced because a tab closing runs a turn's save and the
    scope's close-save within the same moment.
  */
  onMemoryChanged(debounce(refresh, 150));

  document.getElementById('forget-all')?.addEventListener('click', async () => {
    // Deliberately blunt. This is the one irreversible control on the page, and
    // it should feel like it.
    if (!confirm('Forget everything in the archive? This cannot be undone.')) return;
    await ask(MemoryAction.MEMORY_FORGET_ALL);
    await refresh();
  });

  await refresh();
});

/**
 * One conversation, with what it holds and what can be done to it.
 *
 * The close button is the point of this card. A tab that crashed never fires
 * `onRemoved`, so nothing ever ends its conversation — the turns sit in a scope
 * that no tab will read again and that no other tab can recall from, because
 * reaching the shared archive is exactly what closing does. Before this there
 * was no way to finish one by hand.
 *
 * Closing is not deleting. Each pool runs its own eviction first, so the turns
 * move into the archive rather than being discarded, and the button says so.
 */
function conversationCard(
  convo: ConversationStat,
  onChange: () => void,
  onSearch: (scope: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `memory-page__convo${convo.live ? '' : ' memory-page__convo--stale'}`;

  const head = document.createElement('div');
  head.className = 'memory-page__convo-head';

  const name = document.createElement('span');
  name.className = 'memory-page__convo-title';
  // The tab's title when it is still open, the scope name when it is not —
  // which is the only identifier a lost conversation still has.
  name.textContent = convo.title ?? convo.scope;
  name.title = convo.scope;

  const state = document.createElement('span');
  state.className = `ac-badge ac-badge--${convo.live ? 'ok' : 'warn'}`;
  state.textContent = convo.live ? '[ OPEN ]' : '[ TAB GONE ]';

  head.append(name, state);

  const counts = document.createElement('p');
  counts.className = 'memory-page__convo-counts ac-mono';
  counts.textContent = [
    `${convo.turns} turns`,
    `${convo.thinking} reasoning`,
    `${convo.actions} tool results`,
    `${convo.indexed} indexed`,
  ].join(' · ');

  const actions = document.createElement('div');
  actions.className = 'memory-page__convo-actions';

  const look = document.createElement('button');
  look.type = 'button';
  look.className = 'ac-btn ac-btn--ghost';
  look.textContent = 'Search this conversation';
  look.addEventListener('click', () => onSearch(convo.scope));

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ac-btn ac-btn--ghost';
  close.textContent = 'Close and archive';
  close.addEventListener('click', async () => {
    const where = convo.title ?? convo.scope;
    if (
      !confirm(
        `End the conversation "${where}"?\n\n` +
          'Its turns move into the shared archive, where every tab can recall ' +
          'them. Nothing is deleted.',
      )
    ) {
      return;
    }

    close.disabled = true;
    close.textContent = 'Closing…';
    await ask(MemoryAction.MEMORY_CLOSE, { scope: convo.scope });
    onChange();
  });

  actions.append(look, close);

  if (!convo.live) {
    const why = document.createElement('p');
    why.className = 'memory-page__convo-why';
    why.textContent =
      'This tab is gone but its conversation was never ended, so its turns have ' +
      'not reached the shared archive and no other tab can recall them. Closing ' +
      'it moves them across.';
    card.append(head, counts, why, actions);
    return card;
  }

  card.append(head, counts, actions);
  return card;
}

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

  /*
    Tags for what this entry is carrying beyond the exchange itself.

    An entry used to render as one blob of question and answer, which hid the
    biggest thing in it: an attached page is thousands of characters against a
    question of maybe sixty, and all of it is indexed for recall. A turn holding
    a page therefore matches far more questions than the exchange alone would,
    and nothing on the page said so. The tag says so, and carries the size.
  */
  const tags = document.createElement('span');
  tags.className = 'memory-page__tags';

  for (const part of entry.parts) {
    const tag = document.createElement('span');
    tag.className = `memory-page__tag memory-page__tag--${part.id}`;
    tag.textContent = part.chars !== undefined ? `${part.label} ${sizeOf(part.chars)}` : part.label;
    tag.title = part.note;
    tags.appendChild(tag);
  }

  summary.append(kind, text, tags, meta);

  const body = document.createElement('div');
  body.className = 'memory-page__entry-body';

  const detail = document.createElement('pre');
  detail.className = 'memory-page__entry-detail';
  detail.textContent = entry.detail;

  body.appendChild(detail);

  /*
    Each part shown and removable on its own.

    Forgetting the whole turn to be rid of an attached page throws away the
    exchange with it, which is the wrong trade when the exchange is the part
    worth keeping. These remove one piece and leave the rest stored — and the
    worker re-indexes what remains, so a turn stripped of its page stops
    matching questions about that page.
  */
  for (const part of entry.parts) {
    const block = document.createElement('div');
    block.className = 'memory-page__part';

    const head = document.createElement('div');
    head.className = 'memory-page__part-head';

    const name = document.createElement('span');
    name.className = 'memory-page__part-name';
    name.textContent =
      part.chars !== undefined
        ? `${part.label} — ${part.note} (${part.chars.toLocaleString()} characters)`
        : `${part.label} — ${part.note}`;

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'ac-btn ac-btn--ghost';
    drop.textContent = `Forget the ${part.label}`;
    drop.addEventListener('click', async () => {
      drop.disabled = true;
      drop.textContent = 'Forgetting…';
      await ask(MemoryAction.MEMORY_FORGET_PART, { id: entry.id, part: part.id });
      onChange();
    });

    head.append(name, drop);

    const partDetail = document.createElement('pre');
    partDetail.className = 'memory-page__entry-detail memory-page__part-detail';
    partDetail.textContent = part.detail;

    block.append(head, partDetail);
    body.appendChild(block);
  }

  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'ac-btn ac-btn--ghost';
  forget.textContent = entry.parts.length > 0 ? 'Forget the whole entry' : 'Forget this';
  forget.addEventListener('click', async () => {
    await ask(MemoryAction.MEMORY_FORGET, { id: entry.id });
    onChange();
  });

  body.appendChild(forget);
  wrap.append(summary, body);
  return wrap;
}

/** Characters as something readable at a glance. */
function sizeOf(chars: number): string {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
}

/** `window:tab:412` is an internal name; this is what it means. */
/**
 * A shared pool's name, as a person would say it.
 *
 * Only pools belonging to no conversation reach this now. The per-tab ones used
 * to come through here too and lost their scope on the way, which is what
 * produced a grid of identical "OPEN CONVERSATION" cells; they are grouped by
 * conversation before rendering instead.
 */
function labelForPool(name: string): string {
  if (name === 'archive') return 'Archive (shared)';
  if (name === 'tools') return 'Tools';
  return name;
}

/** A failure, said plainly rather than shown as emptiness. */
function problem(message: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'memory-page__problem';
  element.textContent = `Could not read memory: ${message}`;
  return element;
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
