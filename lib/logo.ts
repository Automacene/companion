/**
 * The Automacene mark, as a live element rather than an image.
 *
 * `assets/logo.svg` is the master branding file. It is imported here as raw
 * markup and injected into the page, which is what makes the difference between
 * a picture of the logo and a logo that participates in the interface:
 *
 *   - Its colours are custom properties, so it follows the theme and any token
 *     the user has overridden. As an `<img>` it could not see them, and its
 *     hardcoded charcoal was nearly invisible against the dark background.
 *   - Its parts are real elements, so the core square can pulse and be clicked.
 *     Nothing inside an `<img>` can receive a pointer event.
 *
 * Kept as one component rather than pasted into each page, because the sidepanel
 * hero and the settings hub both draw it and two copies would drift.
 */
import markup from '../assets/logo.svg?raw';

/**
 * Filter ids are document-global once the SVG is inlined, so two logos on one
 * page would both point `url(#ac-logo-glow)` at whichever landed first. Each
 * instance gets its own id instead.
 */
let instanceCount = 0;

/**
 * The full artwork.
 */
const VIEWBOX_FULL = '0 0 390 290';

/**
 * Just the core square.
 *
 * The rect is `x=381 y=151 w=38 h=38` inside a group translated by
 * `(-205, -80)`, so its centre sits at (195, 90) in viewBox coordinates.
 * Rotated 45 degrees its bounding box is the diagonal, 38 × √2 ≈ 53.74, which
 * is where 168/63/54/54 comes from.
 *
 * Reframing rather than scaling down is the whole point: the square keeps the
 * size it had inside the full mark instead of shrinking with it.
 */
const VIEWBOX_MARK = '168 63 54 54';

export type LogoMode = 'full' | 'mark';

export interface LogoOptions {
  /**
   * Render as a button. Use when clicking it does something — in the sidepanel
   * it brings the collapsed hero back.
   *
   * A button wrapping the whole mark rather than a hit area over the square:
   * SVG children are not reliably focusable, and the square alone is a very
   * small target.
   */
  interactive?: boolean;
  /** Accessible name. Only meaningful when `interactive`. */
  label?: string;
  /** Extra classes for the outer element. */
  className?: string;
}

/**
 * Build a logo element.
 *
 * @returns a `<button>` when interactive, otherwise a `<span>`. Either way the
 *   SVG is inside it and `.ac-logo` is on the outside.
 */
export function createLogo({
  interactive = false,
  label = 'Automacene',
  className = '',
}: LogoOptions = {}): HTMLElement {
  const id = `ac-logo-glow-${++instanceCount}`;

  // Both the definition and the reference, or the glow silently stops applying.
  const scoped = markup
    .replaceAll('id="ac-logo-glow"', `id="${id}"`)
    .replaceAll('url(#ac-logo-glow)', `url(#${id})`);

  const host = document.createElement(interactive ? 'button' : 'span');
  host.className = ['ac-logo', interactive ? 'ac-logo--interactive' : '', className]
    .filter(Boolean)
    .join(' ');

  if (interactive) {
    (host as HTMLButtonElement).type = 'button';
    host.setAttribute('aria-label', label);
  }

  // Static markup from our own bundle, not user content, and SVG injected this
  // way cannot execute script.
  host.innerHTML = scoped;

  // The mark is decorative once the wrapper carries the name, and a nested
  // label would be announced twice.
  if (interactive) {
    const art = host.querySelector('svg');
    art?.removeAttribute('role');
    art?.removeAttribute('aria-label');
    art?.setAttribute('aria-hidden', 'true');
  }

  return host;
}

/**
 * Switch between the whole mark and the core square on its own.
 *
 * `mark` is what the collapsed sidepanel hero shows. It is not a smaller logo —
 * the viewBox is reframed onto the square so the square renders at the size it
 * already had, and everything around it is hidden. That is the behaviour the
 * old absolutely-positioned badge was faking by covering the artwork.
 */
export function setLogoMode(host: HTMLElement | null, mode: LogoMode): void {
  if (!host) return;

  const art = host.querySelector('svg');
  if (!art) return;

  host.classList.toggle('ac-logo--mark', mode === 'mark');
  art.setAttribute('viewBox', mode === 'mark' ? VIEWBOX_MARK : VIEWBOX_FULL);
}

/**
 * Replace a placeholder element with the logo, keeping its classes.
 *
 * Lets a page mark the spot in its HTML — where the logo goes is layout, and
 * layout belongs in the markup — while the mark itself is built here.
 *
 * @param selector  element to replace
 * @returns the new element, or null if the placeholder was not found
 */
export function mountLogo(selector: string, options: LogoOptions = {}): HTMLElement | null {
  const placeholder = document.querySelector(selector);
  if (!placeholder) return null;

  const logo = createLogo({
    ...options,
    className: [placeholder.className, options.className].filter(Boolean).join(' '),
  });

  placeholder.replaceWith(logo);
  return logo;
}
