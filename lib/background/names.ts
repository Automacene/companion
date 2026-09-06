/**
 * What a conversation is called.
 *
 * The id stays opaque because it is baked into the name of every pool the
 * conversation owns; a name is a label hung on it, which is what makes renaming
 * free. Two tabs that started apart and landed on the same page are genuinely
 * indistinguishable, so recovery cannot be made reliable - a name on screen
 * makes a wrong guess visible instead, and correctable.
 *
 * Kept apart from the recovery records, which are capped and pruned by age.
 */

const NAMES_KEY = 'companion-conversation-names';

/** Longer than this and a header turns into a paragraph. */
const MAX_NAME = 48;

/**
 * Separators sites put between a page title and their own name.
 *
 * Trimmed because the site half is furniture: left alone, every conversation
 * ends up called something " - Wikipedia" or something " | LinkedIn", and the
 * part that identifies it gets cut off first when the header runs out of room.
 */
const TITLE_SEPARATORS = [' | ', ' - ', ' - ', ' - ', ' · ', ' :: ', ' » '];

/** Below this, a trailing segment is a site name rather than part of the title. */
const SUFFIX_MAX = 30;

export class ConversationNames {
  private names = new Map<string, string>();
  private loaded = false;

  /** The name for a conversation, or null if it has never had one. */
  public async get(id: string): Promise<string | null> {
    await this.load();
    return this.names.get(id) ?? null;
  }

  /**
   * Name a conversation from what it started on, unless it already has one.
   *
   * Never overwrites. A generated name is a first guess and an edited one is a
   * decision, so the guess must not come back and replace the decision when the
   * tab happens to navigate somewhere with a title.
   */
  public async ensure(id: string, title?: string, url?: string): Promise<string> {
    await this.load();

    const existing = this.names.get(id);
    if (existing) return existing;

    const name = nameFrom(title, url);
    this.names.set(id, name);
    await this.save();
    return name;
  }

  /** Rename it. An empty name is not a name, so it is refused. */
  public async rename(id: string, name: string): Promise<string | null> {
    await this.load();

    const trimmed = name.trim().slice(0, MAX_NAME);
    if (!trimmed) return this.names.get(id) ?? null;

    this.names.set(id, trimmed);
    await this.save();
    return trimmed;
  }

  /** Every name, for the memory page. */
  public async all(): Promise<Record<string, string>> {
    await this.load();
    return Object.fromEntries(this.names);
  }

  /** Drop a name whose conversation is gone. */
  public async forget(id: string): Promise<void> {
    await this.load();
    if (!this.names.delete(id)) return;
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const stored = await browser.storage.local.get(NAMES_KEY);
      const saved = (stored?.[NAMES_KEY] ?? {}) as Record<string, string>;
      for (const [id, name] of Object.entries(saved)) this.names.set(id, name);
    } catch (error) {
      console.warn('[names] could not read conversation names:', error);
    }
  }

  private async save(): Promise<void> {
    try {
      await browser.storage.local.set({ [NAMES_KEY]: Object.fromEntries(this.names) });
    } catch (error) {
      console.warn('[names] could not save conversation names:', error);
    }
  }
}

/**
 * A name from the page a conversation started on.
 *
 * The page title is the only thing available when a conversation is created -
 * the first question would describe it better, but it has not been asked yet.
 * A title makes a serviceable first guess once the site's own name is taken off
 * the end of it.
 */
export function nameFrom(title?: string, url?: string): string {
  const cleaned = trimSiteSuffix(title ?? '');
  if (cleaned) return cleaned.slice(0, MAX_NAME);

  // No usable title. The host at least says where you were.
  try {
    if (url) return new URL(url).hostname.replace(/^www\./, '').slice(0, MAX_NAME);
  } catch {
    // Not a url worth reporting.
  }

  return 'Untitled conversation';
}

/**
 * Drop a trailing site name, if that is what the last segment is.
 *
 * Length is the test. A short tail after a separator is a site - "Wikipedia",
 * "LinkedIn", "GitHub" - while a long one is usually part of what the page is
 * actually about, and cutting it would throw away the useful half. Only the
 * last segment is considered, so "Quantum computing - Wikipedia" loses one
 * piece and a title that merely contains a dash keeps its shape.
 */
function trimSiteSuffix(title: string): string {
  let out = title.trim();
  if (!out) return '';

  for (const separator of TITLE_SEPARATORS) {
    const at = out.lastIndexOf(separator);
    if (at <= 0) continue;

    const head = out.slice(0, at).trim();
    const tail = out.slice(at + separator.length).trim();

    if (head && tail.length <= SUFFIX_MAX) {
      out = head;
      break;
    }
  }

  // Some sites lead with their own name, so the tail is not always the site.
  for (const separator of TITLE_SEPARATORS) {
    const at = out.indexOf(separator);
    if (at <= 0) continue;

    const head = out.slice(0, at).trim();
    const rest = out.slice(at + separator.length).trim();

    if (rest.length > SUFFIX_MAX && head.length <= SUFFIX_MAX && !head.includes(' ')) {
      out = rest;
      break;
    }
  }

  // And a colon usually separates a name from its description, so the half before it is the name.
  const colon = out.indexOf(': ');
  if (colon > 8 && out.length > MAX_NAME) out = out.slice(0, colon).trim();

  return out;
}
