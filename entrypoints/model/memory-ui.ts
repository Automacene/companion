import {
  MEMORY_PARAMS,
  resolveBudgets,
  shareOf,
  type MemoryShares,
} from '../../lib/mind/memory-params';

/**
 * The memory budget controls.
 *
 * Each one is a share of `num_ctx` rather than a token count, so somebody
 * running llama3.2 at 4,096 and somebody running qwen3.5 at 128,000 do not both
 * have to work out their own numbers. The slider shows the share; the readout
 * shows what that comes to in tokens right now.
 *
 * The total above them is the part with no equivalent today. The library's own
 * defaults sum to 16,000 tokens against a window that defaults to 4,096, and
 * nothing anywhere mentions it. Once these are editable that stops being a
 * defaults problem and becomes something somebody does to themselves.
 */
export interface MemoryUiOptions {
  host: HTMLElement;
  totalHost: HTMLElement;
  values: MemoryShares;
  /** The context length these are shares of. */
  getContextTokens(): number;
  onChange(values: MemoryShares): void;
}

export interface MemoryUi {
  setValues(values: MemoryShares): void;
  /** Recompute after `num_ctx` changes, since every figure derives from it. */
  refresh(): void;
}

export function renderMemory({
  host,
  totalHost,
  values,
  getContextTokens,
  onChange,
}: MemoryUiOptions): MemoryUi {
  let current: MemoryShares = { ...values };
  const readouts = new Map<string, HTMLElement>();

  function updateTotal(): void {
    const contextTokens = getContextTokens();
    const { total, over } = resolveBudgets(current, contextTokens);

    totalHost.replaceChildren();
    totalHost.classList.toggle('is-over', over);

    const figure = document.createElement('span');
    figure.className = 'model-page__memory-figure ac-mono';
    figure.textContent = `${total.toLocaleString()} / ${contextTokens.toLocaleString()} tokens`;

    const note = document.createElement('span');
    note.className = 'ac-field__hint';
    note.textContent = over
      ? 'Over the context window. The model will drop the oldest part of the prompt.'
      : 'Fits, with room left for the system prompt and any tools.';

    totalHost.append(figure, note);
  }

  function updateReadouts(): void {
    const { tokens } = resolveBudgets(current, getContextTokens());
    for (const param of MEMORY_PARAMS) {
      const readout = readouts.get(param.id);
      if (!readout) continue;

      /*
        `recallCount` is a count of items, not a share of `num_ctx` — see the
        comment on it in memory-params.ts. Running it through the same
        "share% · tokens" formatting as everything else printed "1500% · 15
        tokens" for a value of 15: `shareOf` returned the raw count, multiplying
        by 100 turned 15 into 1500, and it is not a token figure at all.
      */
      if (param.id === 'recallCount') {
        const count = tokens[param.id];
        readout.textContent = `${count} ${count === 1 ? 'memory' : 'memories'}`;
        continue;
      }

      const share = Math.round(shareOf(current, param.id) * 100);
      // Thinking and action never enter the prompt, so saying "of context"
      // about them would be wrong.
      readout.textContent = `${share}% · ${tokens[param.id].toLocaleString()} tokens${
        param.inPrompt ? '' : ' (stored, not sent)'
      }`;
    }
  }

  function draw(): void {
    host.replaceChildren();
    readouts.clear();

    for (const param of MEMORY_PARAMS) {
      const field = document.createElement('div');
      field.className = 'ac-field';

      const head = document.createElement('div');
      head.className = 'model-page__param-head';

      const label = document.createElement('label');
      label.className = 'ac-field__label';
      label.htmlFor = `memory-${param.id}`;
      label.textContent = param.label;

      const readout = document.createElement('span');
      readout.className = 'model-page__memory-readout ac-mono';
      readouts.set(param.id, readout);

      head.append(label, readout);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `memory-${param.id}`;
      slider.className = 'ac-range';
      slider.min = String(param.min);
      slider.max = String(param.max);
      slider.step = String(param.step);
      slider.value = String(shareOf(current, param.id));

      // Dragging updates the readouts and the total live; the write waits for
      // the gesture to end, so one drag is one save rather than a hundred.
      slider.addEventListener('input', () => {
        current = { ...current, [param.id]: Number(slider.value) };
        updateReadouts();
        updateTotal();
      });
      slider.addEventListener('change', () => onChange({ ...current }));

      const hint = document.createElement('p');
      hint.className = 'ac-field__hint';
      hint.textContent = param.description;

      field.append(head, slider, hint);
      host.appendChild(field);
    }

    updateReadouts();
    updateTotal();
  }

  draw();

  return {
    setValues(next) {
      current = { ...next };
      draw();
    },
    refresh() {
      updateReadouts();
      updateTotal();
    },
  };
}
