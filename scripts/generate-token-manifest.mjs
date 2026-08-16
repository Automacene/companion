/**
 * Generates `lib/theme/manifest.generated.ts` from the CSS in `styles/tokens/`.
 *
 * The CSS is the single source of truth. Adding a token to a palette makes it
 * appear in the theme editor with no second file to update, which is the only
 * way a hand-maintained manifest stays correct for longer than a week.
 *
 * What it reads:
 *   structure.css      theme-independent values (spacing, radii, motion)
 *   palette-<name>.css one set of colour values per theme
 *
 * How it types a token: by name. `--ac-color-*` is a colour, `--ac-space-*` is
 * a length, and so on. That convention is load-bearing rather than cosmetic —
 * break it and a token gets the wrong editor control.
 *
 * How it labels a token: from the name, unless a `@label` / `@describe`
 * annotation sits in the comment directly above it.
 *
 *   /* @label Accent
 *      @describe Buttons, links, and anything asking to be clicked. *\/
 *   --ac-color-accent: #ea580c;
 *
 * Run with `npm run generate:tokens`. Also runs automatically before `dev`
 * and `build`.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_DIR = join(ROOT, 'styles', 'tokens');
const OUT_FILE = join(ROOT, 'lib', 'theme', 'manifest.generated.ts');

/**
 * Name prefix to the kind of control the editor should show. Ordered longest
 * first so `--ac-color-grid-line` cannot be caught by a shorter prefix.
 */
const KIND_BY_PREFIX = [
  ['--ac-color-', 'color'],
  ['--ac-shadow-', 'shadow'],
  ['--ac-blur-', 'filter'],
  ['--ac-font-', 'font'],
  ['--ac-text-', 'length'],
  ['--ac-space-', 'length'],
  ['--ac-radius-', 'length'],
  ['--ac-grid-', 'length'],
  ['--ac-logo-', 'length'],
  ['--ac-duration-', 'duration'],
  ['--ac-transition-', 'duration'],
  ['--ac-ease-', 'easing'],
  ['--ac-leading-', 'number'],
  ['--ac-tracking-', 'length'],
  ['--ac-weight-', 'number'],
  ['--ac-z-', 'layer'],
];

/**
 * Tokens the editor must not offer. Layering is structural: letting someone
 * put the backdrop above the modal produces a UI they cannot escape from.
 */
const NOT_EDITABLE = new Set(['layer']);

/**
 * Whether a token is built out of other tokens.
 *
 * `--ac-transition-base` is `var(--ac-duration-base) var(--ac-ease-out)`, so it
 * already changes when either of those does. Offering it for editing would
 * show the same setting twice, and typing a literal into it would quietly cut
 * the link — the duration slider would stop having any effect and there would
 * be nothing on screen explaining why.
 */
function isDerived(value) {
  return value.includes('var(');
}

/**
 * Group heading, from the second segment of the name.
 *
 * Deliberately few. Twelve headings named after CSS properties is a filing
 * system rather than an editor — several of them would hold two entries, and a
 * person looking for "how round are the corners" should not have to know
 * whether that lives under Radius or Shape.
 */
const GROUP_LABELS = {
  color: 'Colours',

  radius: 'Shape & depth',
  shadow: 'Shape & depth',
  blur: 'Shape & depth',

  font: 'Text',
  text: 'Text',
  weight: 'Text',
  leading: 'Text',
  tracking: 'Text',

  space: 'Spacing',
  grid: 'Spacing',
  logo: 'Spacing',

  duration: 'Motion',
  transition: 'Motion',
  ease: 'Motion',

  z: 'Layering',
};

/**
 * The order groups appear in, most-noticed first.
 *
 * Colour is what anyone opening this page came for. Corner radius and shadow
 * are the next thing the eye reads, because together they decide whether the
 * interface looks soft or sharp. Text, spacing, and motion are real but rarely
 * the reason somebody opened the editor.
 *
 * Anything not listed sorts to the end, so adding a token with a new prefix
 * cannot silently push Colours down the page.
 */
const GROUP_ORDER = ['Colours', 'Shape & depth', 'Text', 'Spacing', 'Motion'];

/** `--ac-color-accent-soft` -> `Accent soft`. */
function labelFrom(name) {
  const withoutPrefix = name.replace(/^--ac-[a-z]+-/, '');
  const words = withoutPrefix.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindFrom(name) {
  for (const [prefix, kind] of KIND_BY_PREFIX) {
    if (name.startsWith(prefix)) return kind;
  }
  return 'other';
}

function groupKeyFrom(name) {
  const match = name.match(/^--ac-([a-z]+)-/);
  return match ? match[1] : 'other';
}

/**
 * Pull every custom property declaration out of one stylesheet, along with any
 * `@label` / `@describe` annotation in the comment immediately above it.
 *
 * Deliberately a regex rather than a CSS parser. The token files are the one
 * part of the stylesheet tree guaranteed to be flat declarations with no
 * nesting, so there is nothing here for a parser to earn.
 */
function parseTokens(css) {
  const found = new Map();

  // Comment (optional) followed by a custom property declaration.
  const pattern = /(?:\/\*([\s\S]*?)\*\/\s*)?(--ac-[a-z0-9-]+)\s*:\s*([^;]+);/g;

  let match;
  while ((match = pattern.exec(css)) !== null) {
    const [, comment, name, rawValue] = match;
    const value = rawValue.trim().replace(/\s+/g, ' ');

    const annotations = {};
    if (comment) {
      const label = comment.match(/@label\s+(.+)/);
      const describe = comment.match(/@describe\s+([\s\S]+?)(?:@|$)/);
      if (label) annotations.label = label[1].trim();
      if (describe) {
        annotations.description = describe[1].trim().replace(/\s*\n\s*\*?\s*/g, ' ');
      }
    }

    // Later declarations win, matching how the cascade would resolve them.
    found.set(name, { name, value, ...annotations });
  }

  return found;
}

function readPalettes() {
  const palettes = new Map();

  for (const file of readdirSync(TOKENS_DIR).sort()) {
    const paletteMatch = basename(file).match(/^palette-([a-z0-9-]+)\.css$/);
    if (!paletteMatch) continue;

    const themeName = paletteMatch[1];
    palettes.set(themeName, parseTokens(readFileSync(join(TOKENS_DIR, file), 'utf8')));
  }

  return palettes;
}

/**
 * Every stylesheet outside `tokens/`, so a `var(--ac-…)` referencing a token
 * that does not exist can be caught.
 *
 * A misspelled custom property is silent: the declaration is simply dropped and
 * the element renders with no colour at all. That is a genuinely hard bug to
 * see in a dark UI, so it is worth failing the build over.
 */
function collectStylesheets(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectStylesheets(path, found);
    } else if (entry.name.endsWith('.css') && !path.includes(join('styles', 'tokens'))) {
      found.push(path);
    }
  }

  return found;
}

function checkReferences(defined) {
  const problems = [];

  const sheets = [
    ...collectStylesheets(join(ROOT, 'styles')),
    ...collectStylesheets(join(ROOT, 'entrypoints')),
  ];

  for (const sheet of sheets) {
    const css = readFileSync(sheet, 'utf8');
    const pattern = /var\(\s*(--ac-[a-z0-9-]+)/g;

    let match;
    while ((match = pattern.exec(css)) !== null) {
      const name = match[1];
      if (defined.has(name)) continue;

      const line = css.slice(0, match.index).split('\n').length;
      problems.push(`${sheet.replace(ROOT + '/', '')}:${line} references undefined ${name}`);
    }
  }

  return problems;
}

function build() {
  const structure = parseTokens(readFileSync(join(TOKENS_DIR, 'structure.css'), 'utf8'));
  const palettes = readPalettes();

  if (palettes.size === 0) {
    throw new Error('[tokens] no palette-*.css files found in styles/tokens/');
  }

  const themeNames = [...palettes.keys()];

  // Light is the contract: every token it defines must exist everywhere else.
  const reference = palettes.get('light') ?? palettes.get(themeNames[0]);
  const gaps = [];

  for (const [themeName, tokens] of palettes) {
    for (const name of reference.keys()) {
      if (!tokens.has(name)) gaps.push(`${themeName} is missing ${name}`);
    }
  }

  if (gaps.length > 0) {
    throw new Error(
      `[tokens] palettes disagree, so a theme would fall back to another theme's colour:\n  ` +
        gaps.join('\n  ')
    );
  }

  const defined = new Set([...structure.keys(), ...reference.keys()]);
  const danglingReferences = checkReferences(defined);

  if (danglingReferences.length > 0) {
    throw new Error(
      `[tokens] stylesheets reference tokens that do not exist, so those declarations ` +
        `are being dropped silently:\n  ` +
        danglingReferences.join('\n  ')
    );
  }

  /** Structural tokens first, then palette tokens, in declaration order. */
  const entries = [];

  for (const token of structure.values()) {
    const kind = kindFrom(token.name);
    entries.push({
      name: token.name,
      label: token.label ?? labelFrom(token.name),
      description: token.description ?? null,
      kind,
      group: GROUP_LABELS[groupKeyFrom(token.name)] ?? 'Other',
      themed: false,
      editable: !NOT_EDITABLE.has(kind) && !isDerived(token.value),
      values: { _: token.value },
    });
  }

  for (const token of reference.values()) {
    const kind = kindFrom(token.name);
    const values = {};
    for (const [themeName, tokens] of palettes) {
      values[themeName] = tokens.get(token.name).value;
    }

    entries.push({
      name: token.name,
      label: token.label ?? labelFrom(token.name),
      description: token.description ?? null,
      kind,
      group: GROUP_LABELS[groupKeyFrom(token.name)] ?? 'Other',
      themed: true,
      editable: !NOT_EDITABLE.has(kind) && !isDerived(token.value),
      values,
    });
  }

  // Group order is fixed rather than taken from declaration order, so a token
  // added to a new prefix cannot push Colours down the page.
  const present = [...new Set(entries.filter((entry) => entry.editable).map((e) => e.group))];
  const orderedGroups = [
    ...GROUP_ORDER.filter((group) => present.includes(group)),
    ...present.filter((group) => !GROUP_ORDER.includes(group)).sort(),
  ];

  const source = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by \`scripts/generate-token-manifest.mjs\` from the CSS in
 * \`styles/tokens/\`. Change a token there and re-run \`npm run generate:tokens\`.
 *
 * ${entries.length} tokens across ${themeNames.length} themes.
 */

/** The control the theme editor shows for a token. */
export type TokenKind =
  | 'color'
  | 'length'
  | 'duration'
  | 'number'
  | 'font'
  | 'shadow'
  | 'filter'
  | 'easing'
  | 'layer'
  | 'other';

export interface TokenDefinition {
  /** Custom property name, including the leading dashes. */
  name: string;
  /** Human-readable name for the editor. */
  label: string;
  /** Longer explanation, from an \`@describe\` annotation. */
  description: string | null;
  /** Which control to render. */
  kind: TokenKind;
  /** Heading to file this token under. */
  group: string;
  /** Whether the value differs per theme. Structural tokens do not. */
  themed: boolean;
  /** Whether a user may change it. Layering is locked. */
  editable: boolean;
  /**
   * Default per theme. Unthemed tokens use the single key \`_\`.
   */
  values: Record<string, string>;
}

/** Theme names with a palette file, in load order. */
export const THEME_NAMES = ${JSON.stringify(themeNames)} as const;

export const TOKENS: TokenDefinition[] = ${JSON.stringify(entries, null, 2)};

/** Lookup by custom property name. */
export const TOKENS_BY_NAME: ReadonlyMap<string, TokenDefinition> = new Map(
  TOKENS.map((token) => [token.name, token])
);

/** Editable tokens only, in the order the editor should show them. */
export const EDITABLE_TOKENS: TokenDefinition[] = TOKENS.filter((token) => token.editable);

/**
 * Group headings, most-noticed first. See GROUP_ORDER in the generator for why
 * this order and not declaration order.
 */
export const TOKEN_GROUPS: string[] = ${JSON.stringify(orderedGroups)};

/**
 * The default value of a token under a theme, falling back to the unthemed
 * value for structural tokens.
 */
export function defaultValue(token: TokenDefinition, theme: string): string {
  return token.values[theme] ?? token.values._ ?? '';
}
`;

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, source, 'utf8');

  console.log(
    `[tokens] wrote ${entries.length} tokens (${
      entries.filter((entry) => entry.editable).length
    } editable) across ${themeNames.length} themes -> lib/theme/manifest.generated.ts`
  );
}

build();
