/**
 * The generation parameter controls.
 *
 * Rendered from `lib/model-params.ts`, so this file knows how to draw a
 * parameter but not which parameters exist. Adding one to that list adds a
 * control here and starts sending it, with nothing to change in between.
 *
 * Every control can be empty, and empty is meaningful: Ollama has no value for
 * "use the model's default", only the absence of the key. So a cleared box has
 * to actually clear the stored value rather than write a zero - which is what
 * the previous page did with `parseInt(value) || 0`, quietly asking for a
 * zero-token context window.
 */
import {
  PARAMS,
  PARAM_GROUPS,
  placeholderFor,
  type ParamDef,
  type ParamValues,
} from '../../lib/model-params';

export interface ParamsUiOptions {
  host: HTMLElement;
  /** Current values, keyed by parameter id. */
  values: ParamValues;
  /** Called whenever a control changes, with the complete new set. */
  onChange(values: ParamValues): void;
}

export interface ParamsUi {
  /** Redraw from a new set of values, after a reset or a reload. */
  setValues(values: ParamValues): void;
}

export function renderParams({ host, values, onChange }: ParamsUiOptions): ParamsUi {
  let current: ParamValues = { ...values };

  /** Per-row "reflect the current state" callbacks, keyed by parameter id. */
  const syncers = new Map<string, () => void>();

  /** Per-control "put my widgets back where they belong" callbacks. */
  const refreshers = new Map<string, () => void>();

  /** The "n set" counters on each group heading. */
  const counters = new Map<string, () => void>();

  function updateGroupCounts(): void {
    for (const update of counters.values()) update();
  }

  function set(id: string, raw: string): void {
    // Empty means "unset", which has to remove the key.
    if (raw === '') delete current[id];
    else current[id] = raw;

    onChange({ ...current });
    syncers.get(id)?.();
    updateGroupCounts();
  }

  function draw(): void {
    host.replaceChildren();
    syncers.clear();
    refreshers.clear();
    counters.clear();

    for (const group of PARAM_GROUPS) {
      const params = PARAMS.filter((param) => param.group === group);
      if (params.length === 0) continue;

      const section = document.createElement('details');
      section.className = 'model-page__param-group';
      // All collapsed.
      section.open = false;

      const summary = document.createElement('summary');
      summary.className = 'model-page__param-summary';

      const name = document.createElement('span');
      name.textContent = group;

      const meta = document.createElement('span');
      meta.className = 'model-page__param-meta ac-mono';

      const updateCount = () => {
        const changed = params.filter((param) => param.id in current).length;
        meta.textContent = changed > 0 ? `${changed} set` : 'defaults';
      };
      counters.set(group, updateCount);
      updateCount();

      summary.append(name, meta);
      section.appendChild(summary);

      for (const param of params) section.appendChild(row(param));

      host.appendChild(section);
    }
  }

  function row(param: ParamDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'model-page__param';

    const label = document.createElement('label');
    label.className = 'ac-field__label';
    label.htmlFor = `param-${param.id}`;
    label.textContent = param.label;

    const key = document.createElement('code');
    key.className = 'model-page__param-key';
    key.textContent = param.id;

    /**
     * Clearing rather than writing the default.
     *
     * Setting the control back to 0.8 and setting it to "unset" look identical
     * on screen but are different requests: one pins temperature to 0.8 forever,
     * the other lets the model choose - and a model whose own default differs
     * would be overridden by the first. Revert always removes the key.
     */
    const revert = document.createElement('button');
    revert.type = 'button';
    revert.className = 'ac-btn ac-btn--ghost model-page__param-revert';
    revert.textContent = 'Revert';
    revert.title = `Back to the model default${
      param.defaultValue !== undefined ? ` (${param.defaultValue})` : ''
    }`;

    const head = document.createElement('div');
    head.className = 'model-page__param-head';
    head.append(label, key, revert);

    const control = param.kind === 'select' ? select(param) : input(param);

    const hint = document.createElement('p');
    hint.className = 'ac-field__hint';
    hint.textContent = param.description;

    wrap.append(head, control, hint);

    // One place that decides what "set" looks like, so the row marker.
    const sync = () => {
      const isSet = param.id in current;
      wrap.classList.toggle('is-set', isSet);
      revert.disabled = !isSet;
      refreshers.get(param.id)?.();
    };

    revert.addEventListener('click', () => {
      delete current[param.id];
      onChange({ ...current });
      sync();
      updateGroupCounts();
    });

    syncers.set(param.id, sync);
    sync();

    return wrap;
  }

  function select(param: ParamDef): HTMLElement {
    const element = document.createElement('select');
    element.id = `param-${param.id}`;
    element.className = 'ac-input';

    for (const choice of param.choices ?? []) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      element.appendChild(option);
    }

    element.value = String(current[param.id] ?? '');
    element.addEventListener('change', () => set(param.id, element.value));

    refreshers.set(param.id, () => {
      element.value = String(current[param.id] ?? '');
    });

    return element;
  }

  /**
   * A slider paired with a number box.
   *
   * The slider is the approachable control but it cannot express "unset" -
   * every handle position is a value. So the box beside it is the one that can
   * be emptied, and while nothing is set the slider rests at the model's own
   * default and is faded to say the position is not in force.
   *
   * Resting at the default rather than at the minimum matters: a temperature
   * slider pinned left implies the model is running at 0, which is a very
   * different thing from running unset.
   */
  function input(param: ParamDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'model-page__param-control';

    const box = document.createElement('input');
    box.id = `param-${param.id}`;
    box.className = 'ac-input ac-input--mono model-page__param-box';
    box.placeholder = placeholderFor(param);
    box.value = String(current[param.id] ?? '');

    if (param.kind === 'text') {
      box.type = 'text';
      box.addEventListener('change', () => set(param.id, box.value.trim()));
      refreshers.set(param.id, () => {
        box.value = String(current[param.id] ?? '');
      });
      wrap.appendChild(box);
      return wrap;
    }

    box.type = 'number';
    if (param.min !== undefined) box.min = String(param.min);
    if (param.max !== undefined) box.max = String(param.max);
    if (param.step !== undefined) box.step = String(param.step);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ac-range model-page__param-range';
    slider.setAttribute('aria-label', param.label);
    if (param.min !== undefined) slider.min = String(param.min);
    if (param.max !== undefined) slider.max = String(param.max);
    if (param.step !== undefined) slider.step = String(param.step);

    /** Where the handle sits when nothing is set. */
    const restingPoint = String(param.defaultValue ?? param.min ?? 0);

    const refresh = () => {
      const isSet = param.id in current;
      box.value = isSet ? String(current[param.id]) : '';
      slider.value = isSet ? String(current[param.id]) : restingPoint;
      slider.classList.toggle('is-unset', !isSet);
    };

    slider.addEventListener('input', () => {
      box.value = slider.value;
      slider.classList.remove('is-unset');
    });
    slider.addEventListener('change', () => set(param.id, slider.value));

    box.addEventListener('change', () => set(param.id, box.value.trim()));

    refreshers.set(param.id, refresh);
    refresh();

    wrap.append(slider, box);
    return wrap;
  }

  draw();

  return {
    setValues(next) {
      current = { ...next };
      draw();
    },
  };
}
