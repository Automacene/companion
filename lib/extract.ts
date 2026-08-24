/**
 * Reading a page the way a person would.
 *
 * The rule this file follows: keep what somebody looking at the screen would
 * read, and drop everything else. That sounds obvious and it is the one thing
 * the previous version could not do, because it worked on a string.
 *
 * What it replaced captured `document.documentElement.outerHTML`, sent the
 * whole thing to the background worker, and pulled tags off it with regular
 * expressions. Measured against a real LinkedIn profile that produced 603,821
 * characters, roughly 151,000 tokens against a context window of 8,192. The
 * budget then kept the first 8,868 characters and threw away 98.5% of the rest
 * — and the first 8,868 characters of LinkedIn are the navigation bar, so the
 * model was handed nine thousand characters of menus and correctly reported
 * that no content had been provided.
 *
 * Three things are possible here that were not possible on a string:
 *
 *   Elements can be dropped for what they are. A `nav` is furniture whatever
 *   words are inside it.
 *
 *   Elements can be dropped for not being on screen. `checkVisibility` answers
 *   the actual question — would a person see this — and catches collapsed
 *   menus, inactive tabs, and the second copy of a table that sites render for
 *   a different screen width and hide with CSS.
 *
 *   A block can be scored on how much of its text sits inside links, which is
 *   what separates a navigation list from a paragraph without knowing anything
 *   about the site.
 *
 * It walks the live DOM and never clones or mutates it. Cloning the body was
 * how the first attempt worked, and on a page this size the clone alone is
 * expensive enough to matter. Reading is free; copying is not.
 */

/*
  Node type numbers rather than the `Node.*` constants. `Node` is a global in a
  browser but not anywhere else, so referring to it ties this file to a document
  context it does not otherwise need and breaks it under a test harness.
*/
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Never carries anything readable, whatever the page. */
const NEVER_CONTENT = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'SVG',
  'CANVAS',
  'TEMPLATE',
  'LINK',
  'META',
  'OBJECT',
  'EMBED',
  'AUDIO',
  'VIDEO',
  'MAP',
  'AREA',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'BUTTON',
  'LABEL',
  'FORM',
]);

/** Page furniture by tag. */
const FURNITURE_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'DIALOG', 'MENU']);

/**
 * Page furniture by landmark role.
 *
 * Checked as well as the tag because a site that builds its navigation out of
 * `div`s still usually labels it for screen readers, and that label is the only
 * thing marking it as furniture.
 */
const FURNITURE_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'search',
  'complementary',
  'menubar',
  'menu',
  'toolbar',
  'tablist',
  'alert',
  'status',
  'dialog',
]);

/** Where the main content usually is, best guess first. */
const CONTENT_HINTS = [
  'main',
  '[role="main"]',
  'article',
  '.markdown-body',
  '#content',
  '.post-content',
  '.article-body',
];

export interface ExtractOptions {
  /** Stop after this many characters of output. */
  maxChars?: number;
  /** Keep link targets as `[text](href)`. Off by default; they cost a lot. */
  keepLinks?: boolean;
  /**
   * Skip anything not currently on screen. On by default, and the single
   * biggest reason the output shrinks.
   */
  visibleOnly?: boolean;
}

export interface ExtractResult {
  title: string;
  url: string;
  text: string;
  selection?: string;
  meta: {
    /** How the content block was chosen. */
    strategy: string;
    /** Characters of HTML in the live document, before anything was read. */
    sourceChars: number;
    extractedChars: number;
    truncated: boolean;
    /** Share of the chosen block's text that sat inside links, 0 to 1. */
    linkDensity: number;
    /** Elements skipped for being invisible, furniture, or non-content. */
    skipped: number;
  };
}

const DEFAULTS = { maxChars: 12000, keepLinks: false, visibleOnly: true };

/**
 * Below this share of the painted text, the walk is treated as having failed.
 *
 * Set well under half deliberately. Dropping navigation, headers, and footers
 * legitimately removes a large slice of a page — a third gone is an ordinary
 * result and must not trigger this. Only a near-total loss does.
 */
const SALVAGE_RATIO = 0.25;

/** Too little painted text to judge a ratio against. */
const MIN_PAINTED = 200;

/**
 * What the browser actually laid out, as text.
 *
 * `innerText` rather than `textContent`: the first is computed from layout and
 * so reflects what a person sees, the second returns every character in the
 * tree whether or not it was ever painted. Outside a browser there is no layout
 * to ask, so it is absent and this returns nothing.
 */
function renderedText(element: HTMLElement): string {
  const text = element?.innerText;
  if (typeof text !== 'string') return '';
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPage(doc: Document, options: ExtractOptions = {}): ExtractResult {
  const opts = { ...DEFAULTS, ...options };

  const title = doc.title?.trim() || 'Untitled Page';
  const url = doc.location?.href ?? '';
  const sourceChars = doc.documentElement?.innerHTML?.length ?? 0;

  // A selection beats every heuristic here. If somebody highlighted something,
  // that is a clearer statement of what they mean than anything we could infer.
  const selection = doc.defaultView?.getSelection()?.toString().trim();
  if (selection && selection.length > 40) {
    const text = clamp(selection, opts.maxChars);
    return {
      title,
      url,
      selection,
      text,
      meta: {
        strategy: 'selection',
        sourceChars,
        extractedChars: text.length,
        truncated: text.length < selection.length,
        linkDensity: 0,
        skipped: 0,
      },
    };
  }

  const body = doc.body;
  if (!body) {
    return {
      title,
      url,
      text: '',
      meta: {
        strategy: 'empty',
        sourceChars,
        extractedChars: 0,
        truncated: false,
        linkDensity: 0,
        skipped: 0,
      },
    };
  }

  const found = findContent(doc, body, opts);
  const state = { skipped: 0 };
  const linkDensity = densityOf(found.element);

  let strategy = found.strategy;
  let text = clamp(render(found.element, opts, state), opts.maxChars);

  /*
    Check the walk against what the browser actually painted.

    The walk above reads the DOM tree and applies this file's own rules about
    what counts as content. Those rules are guesses, and on a site that builds
    its page unusually they can be badly wrong in a way nothing here would
    notice — a LinkedIn profile came back with exactly zero characters while the
    page was plainly full of text.

    `innerText` answers a different question and is not a guess: it is the
    browser's own layout-aware account of what a person sees, so it already
    respects every CSS rule, every hidden subtree, and every collapsed section
    without being told about any of them. It makes worse output than the walk —
    no headings, no list structure, and navigation left in — which is why it is
    not the primary path.

    But it is the honest measure of how much text is really there. When the walk
    keeps only a small fraction of it, the rules misfired rather than the page
    being empty, and the browser's flawed answer beats this file's broken one.
    Losing a third of a page to navigation removal is normal and stays; losing
    nearly all of it is a failure and gets replaced.
  */
  const painted = renderedText(found.element) || renderedText(body);

  if (painted.length >= MIN_PAINTED && text.length < painted.length * SALVAGE_RATIO) {
    text = clamp(painted, opts.maxChars);
    strategy = `${found.strategy}+painted`;
  }

  return {
    title,
    url,
    ...(selection ? { selection } : {}),
    text,
    meta: {
      strategy,
      sourceChars,
      extractedChars: text.length,
      truncated: text.length >= opts.maxChars,
      linkDensity: Math.round(linkDensity * 100) / 100,
      skipped: state.skipped,
    },
  };
}

/**
 * Is this something a person would actually see?
 *
 * `checkVisibility` is the real answer and covers `display:none`,
 * `visibility:hidden`, `content-visibility`, and an ancestor hiding a subtree.
 * It exists in Chrome 105 and later, so the fallback is only reached in a test
 * harness, where nothing has layout and everything has to count as visible or
 * the extractor would return nothing at all.
 */
function isVisible(element: Element): boolean {
  const check = (element as any).checkVisibility;
  if (typeof check === 'function') {
    return check.call(element, {
      contentVisibilityAuto: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
  }

  // No layout available, so assume visible rather than discard the page.
  if (typeof (element as HTMLElement).getClientRects !== 'function') return true;
  return true;
}

function isFurniture(element: Element): boolean {
  if (FURNITURE_TAGS.has(element.tagName)) return true;

  const role = element.getAttribute('role');
  if (role && FURNITURE_ROLES.has(role)) return true;

  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.hasAttribute('hidden')) return true;

  return false;
}

/** Should this element's subtree be read at all? */
function isReadable(element: Element, opts: typeof DEFAULTS): boolean {
  if (NEVER_CONTENT.has(element.tagName)) return false;
  if (isFurniture(element)) return false;
  if (opts.visibleOnly && !isVisible(element)) return false;
  return true;
}

/**
 * Pick the block holding the content.
 *
 * A landmark is only trusted when it holds enough text to be plausible. Some
 * pages have a `main` wrapping almost nothing, and an empty landmark is worse
 * than no landmark, so those fall through to scoring.
 */
function findContent(
  doc: Document,
  body: HTMLElement,
  opts: typeof DEFAULTS,
): { element: HTMLElement; strategy: string } {
  for (const selector of CONTENT_HINTS) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    if (opts.visibleOnly && !isVisible(candidate)) continue;
    if (textOf(candidate).length > 200) return { element: candidate, strategy: selector };
  }

  const scored = scoreBlocks(body, opts);
  if (scored) return { element: scored, strategy: 'scored' };

  return { element: body, strategy: 'whole-body' };
}

/**
 * Score every block and take the best.
 *
 * Text length discounted by how much of that text sits inside links. A
 * navigation list is almost entirely link text and scores near zero however
 * long it is; a paragraph of prose keeps nearly its full length.
 */
function scoreBlocks(root: HTMLElement, opts: typeof DEFAULTS): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const block of root.querySelectorAll<HTMLElement>('article,section,main,div,td')) {
    if (!isReadable(block, opts)) continue;

    const length = textOf(block).length;
    if (length < 200) continue;

    const score = length * (1 - densityOf(block));
    if (score > bestScore) {
      bestScore = score;
      best = block;
    }
  }

  return best;
}

function densityOf(element: HTMLElement): number {
  const total = textOf(element).length;
  if (total === 0) return 0;

  let inLinks = 0;
  for (const anchor of element.querySelectorAll('a')) {
    inLinks += textOf(anchor as HTMLElement).length;
  }

  return Math.min(1, inLinks / total);
}

function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Walk the chosen block and write out what a reader would see.
 *
 * Structure is kept only where it changes meaning. Headings carry their level
 * so the outline survives, list items get a bullet, and code keeps its line
 * breaks because collapsing whitespace inside code destroys it.
 */
function render(root: HTMLElement, opts: typeof DEFAULTS, state: { skipped: number }): string {
  const lines: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (text.trim()) append(lines, text);
      return;
    }

    if (node.nodeType !== ELEMENT_NODE) return;

    const el = node as HTMLElement;

    /*
      The furniture and visibility rules apply to what is INSIDE the chosen
      block, never to the block itself.

      Testing the root was how a LinkedIn profile came back with exactly zero
      characters. `findContent` picks a candidate on visibility alone, then this
      re-tested it with the furniture rules as well, and the two disagreed:
      LinkedIn marks `main` with `aria-hidden="true"` whenever an overlay is up
      — the sign-in wall, a cookie prompt — to hold focus in the modal. So the
      block was chosen, rejected on the first call, and the walk ended before it
      began. Every page whose content sits under an open overlay read as blank.

      A block that was deliberately selected as the content is the content. If
      it was the wrong choice, that is a problem for `findContent`, not
      something to express by discarding the page.
    */
    if (el !== root && !isReadable(el, opts)) {
      state.skipped++;
      return;
    }

    if (el === root && NEVER_CONTENT.has(el.tagName)) return;

    const tag = el.tagName.toLowerCase();

    if (tag === 'pre') {
      const code = el.textContent ?? '';
      if (code.trim()) lines.push('', '```\n' + code.trim() + '\n```', '');
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = textOf(el);
      if (text) lines.push('', '#'.repeat(Number(tag[1])) + ' ' + text);
      return;
    }

    if (tag === 'li') {
      const text = textOf(el);
      if (text) lines.push('- ' + text);
      return;
    }

    if (tag === 'a' && opts.keepLinks) {
      const text = textOf(el);
      const href = el.getAttribute('href');
      if (text) append(lines, href ? `[${text}](${href})` : text);
      return;
    }

    if (tag === 'br') {
      lines.push('');
      return;
    }

    for (const child of Array.from(el.childNodes)) walk(child);

    // End the line after a block, or sentences from separate paragraphs run
    // together into one.
    if (/^(p|div|section|article|tr|blockquote|figcaption|dd|dt|h[1-6])$/.test(tag)) {
      lines.push('');
    }
  };

  walk(root);

  return dedupe(lines)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drop lines already seen.
 *
 * A safety net for duplication that visibility does not catch. GitHub emits its
 * whole file table twice for two screen widths; when both copies are somehow
 * visible, every filename would otherwise appear twice.
 *
 * Only exact repeats go, and only after the first. Short lines are kept because
 * a table column of "Yes" and "No" is data, not duplication.
 */
function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const line of lines) {
    const key = line.trim();

    if (key.length <= 8) {
      kept.push(line);
      continue;
    }
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(line);
  }

  return kept;
}

/** Add to the line being built rather than starting a new one. */
function append(lines: string[], text: string): void {
  const last = lines.length - 1;

  if (last >= 0 && lines[last] !== '' && !lines[last]!.startsWith('```')) {
    lines[last] = (lines[last] + ' ' + text).replace(/\s+/g, ' ');
  } else {
    lines.push(text.trim());
  }
}

/**
 * Cut at a paragraph break near the limit.
 *
 * Cutting from the front is what made the old version useless: it kept the
 * first 8,868 characters of a LinkedIn page, which is entirely the navigation
 * bar. By the time this runs the navigation is already gone, so the beginning
 * of the text is the beginning of the content.
 */
function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars);
  const breakAt = cut.lastIndexOf('\n\n');

  return (breakAt > maxChars * 0.6 ? cut.slice(0, breakAt) : cut) + '\n\n[…truncated]';
}
