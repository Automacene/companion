/**
 * The server panel.
 *
 * Answers the three questions that actually come up while using this thing:
 * is Ollama running, is the model in VRAM or crawling on the CPU, and how did
 * the last reply perform.
 *
 * Refreshes on a timer while the page is visible. The expiry countdown is the
 * reason - a model's remaining life is the answer to "why was that message
 * suddenly slow again", and a static number would be wrong the moment it drew.
 */
import {
  fetchModelDetail,
  fetchServerStatus,
  formatBytes,
  formatCountdown,
  formatDuration,
  type ModelDetail,
  type ServerStatus,
} from '../../lib/ollama-status';
import { readLastRun, summarise, type LastRun } from '../../lib/last-run';

/** Often enough for a countdown to tick believably, rarely enough to be free. */
const REFRESH_MS = 3000;

export interface ServerPanelOptions {
  host: HTMLElement;
  /** Current Ollama URL. Read fresh each tick so editing the field re-points it. */
  getHostUrl(): string;
  getTimeoutMs(): number;
  /** The model the sidepanel would use, for the capability lookup. */
  getActiveModel(): string;
}

export interface ServerPanel {
  refresh(): void;
  destroy(): void;
}

export function mountServerPanel({
  host,
  getHostUrl,
  getTimeoutMs,
  getActiveModel,
}: ServerPanelOptions): ServerPanel {
  let timer: number | undefined;
  let detailCache: { model: string; detail: ModelDetail | null } | null = null;
  let inFlight = false;

  async function refresh(): Promise<void> {
    // A slow or unreachable server can outlast the interval.
    if (inFlight) return;
    inFlight = true;

    try {
      const url = getHostUrl();
      const [status, lastRun] = await Promise.all([
        fetchServerStatus(url, getTimeoutMs()),
        readLastRun(),
      ]);

      // `/api/show` costs a round trip and only changes when the model does.
      const model = getActiveModel();
      if (status.reachable && model && detailCache?.model !== model) {
        detailCache = { model, detail: await fetchModelDetail(url, model, getTimeoutMs()) };
      }

      render(status, lastRun, detailCache?.detail ?? null);
    } finally {
      inFlight = false;
    }
  }

  function render(status: ServerStatus, lastRun: LastRun | null, detail: ModelDetail | null): void {
    host.replaceChildren();

    if (!status.reachable) {
      host.appendChild(
        notice(
          'Not reachable',
          status.error ?? 'No response',
          'Check that Ollama is running and that OLLAMA_ORIGINS allows this extension.',
        ),
      );
      return;
    }

    host.appendChild(
      statRow([
        ['Status', 'Running', 'ok'],
        ['Version', status.version ?? 'unknown'],
        ['Loaded', String(status.loaded.length)],
      ]),
    );

    // ── Resident models ──────────────────────────────────────────────────────
    if (status.loaded.length === 0) {
      host.appendChild(
        notice(
          'Nothing loaded',
          'No model is in memory',
          'The next message will load one, which is the slow first request.',
        ),
      );
    } else {
      for (const model of status.loaded) {
        const card = document.createElement('div');
        card.className = 'model-page__server-model';

        const head = document.createElement('div');
        head.className = 'model-page__server-model-head';

        const name = document.createElement('strong');
        name.textContent = model.name;

        const ttl = document.createElement('span');
        ttl.className = 'model-page__server-ttl ac-mono';
        ttl.textContent = formatCountdown(model.expiresAt);

        head.append(name, ttl);
        card.appendChild(head);

        // The split that matters.
        const share = Math.round(model.gpuShare * 100);
        const bar = document.createElement('div');
        bar.className = 'model-page__server-bar';
        const fill = document.createElement('div');
        fill.className = 'model-page__server-bar-fill';
        fill.style.inlineSize = `${share}%`;
        if (share < 100) fill.classList.add('is-partial');
        bar.appendChild(fill);

        const split = document.createElement('p');
        split.className = 'ac-field__hint';
        split.textContent =
          share >= 100
            ? `Entirely on the GPU · ${formatBytes(model.size)}`
            : `${share}% GPU, ${100 - share}% CPU · ${formatBytes(model.sizeVram)} of ${formatBytes(model.size)} in VRAM. The CPU share is what makes it slow.`;

        card.append(bar, split);

        const facts: [string, string][] = [];
        if (model.contextLength) facts.push(['Context', model.contextLength.toLocaleString()]);
        if (model.parameterSize) facts.push(['Size', model.parameterSize]);
        if (model.quantization) facts.push(['Quant', model.quantization]);
        if (facts.length) card.appendChild(chips(facts));

        host.appendChild(card);
      }
    }

    // ── What the active model supports ───────────────────────────────────────
    if (detail) {
      const facts: [string, string][] = [];
      if (detail.contextLength) {
        facts.push(['Max context', detail.contextLength.toLocaleString()]);
      }
      if (detail.capabilities.length) facts.push(['Supports', detail.capabilities.join(', ')]);

      if (facts.length) {
        const section = document.createElement('div');
        section.className = 'model-page__server-detail';

        const heading = document.createElement('p');
        heading.className = 'ac-label';
        heading.textContent = 'Active model';

        section.append(heading, chips(facts));

        // The ceiling for num_ctx.
        if (detail.contextLength) {
          const note = document.createElement('p');
          note.className = 'ac-field__hint';
          note.textContent = `Context window cannot usefully exceed ${detail.contextLength.toLocaleString()} tokens for this model.`;
          section.appendChild(note);
        }

        host.appendChild(section);
      }
    }

    // ── Last run ─────────────────────────────────────────────────────────────
    if (lastRun) {
      const summary = summarise(lastRun);
      const section = document.createElement('div');
      section.className = 'model-page__server-detail';

      const heading = document.createElement('p');
      heading.className = 'ac-label';
      heading.textContent = 'Last reply';
      section.appendChild(heading);

      section.appendChild(
        statRow([
          ['Speed', summary.tokensPerSecond ? `${summary.tokensPerSecond.toFixed(1)} tok/s` : '-'],
          ['Generated', String(lastRun.evalCount)],
          ['Prompt', String(lastRun.promptEvalCount)],
          ['Total', formatDuration(lastRun.totalDuration)],
        ]),
      );

      const notes: string[] = [];
      if (summary.wasColdLoad) {
        notes.push(
          `${formatDuration(lastRun.loadDuration)} of that was loading the model into memory, not generating.`,
        );
      }
      if (summary.hitReplyLimit) {
        notes.push('Stopped at the reply limit rather than finishing - raise num_predict.');
      }

      if (notes.length) {
        const note = document.createElement('p');
        note.className = 'ac-field__hint';
        note.textContent = notes.join(' ');
        section.appendChild(note);
      }

      host.appendChild(section);
    }
  }

  // ── Small builders ───────────────────────────────────────────────────────

  function statRow(items: [string, string, string?][]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'model-page__server-stats';

    for (const [label, value, tone] of items) {
      const cell = document.createElement('div');
      cell.className = 'model-page__server-stat';

      const key = document.createElement('span');
      key.className = 'model-page__server-stat-key';
      key.textContent = label;

      const val = document.createElement('span');
      val.className = 'model-page__server-stat-value';
      if (tone === 'ok') val.classList.add('is-ok');
      val.textContent = value;

      cell.append(key, val);
      wrap.appendChild(cell);
    }

    return wrap;
  }

  function chips(items: [string, string][]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'model-page__server-chips';

    for (const [label, value] of items) {
      const chip = document.createElement('span');
      chip.className = 'model-page__server-chip ac-mono';
      chip.textContent = `${label} ${value}`;
      wrap.appendChild(chip);
    }

    return wrap;
  }

  function notice(title: string, detail: string, hint: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'model-page__server-notice';

    const heading = document.createElement('strong');
    heading.textContent = `${title} - ${detail}`;

    const body = document.createElement('p');
    body.className = 'ac-field__hint';
    body.textContent = hint;

    wrap.append(heading, body);
    return wrap;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function start(): void {
    stop();
    void refresh();
    timer = window.setInterval(() => void refresh(), REFRESH_MS);
  }

  function stop(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  }

  // Polling a local server from a background tab is pointless work.
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  start();

  return {
    refresh: () => void refresh(),
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
