/**
 * Fingerprinting a page's paragraphs, so a reread can be compared to the last.
 *
 * Rereading a page stores a second copy of text you already have, which costs
 * recall accuracy as much as storage: duplicates take more than one of the few
 * slots a question gets, and inflate the document frequency of their own terms.
 *
 * Compared by block rather than by character, because a site that reflows its
 * navigation changes many characters while saying nothing new. `blocksOf` is
 * shared with the chunker so the pieces counted are the pieces stored.
 */

/**
 * A page's paragraphs, as both the chunker and the comparison see them.
 *
 * The extractor separates blocks with a blank line, so this is the seam it
 * already writes rather than a guess imposed on the text.
 */
export function blocksOf(text: string): string[] {
  return (text ?? '')
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * A fingerprint for one block.
 *
 * cyrb53, which is small, synchronous, and spreads well. `crypto.subtle` would
 * be the stronger choice and is asynchronous, which would push an await into
 * the chunker and the scrape path for no benefit that matters here: these
 * identify text rather than authenticate it, and the population being
 * distinguished is the paragraphs of one page.
 *
 * Whitespace is normalised first, so a block that only changed how it wraps is
 * correctly reported as unchanged.
 */
export function hashBlock(block: string): string {
  const text = block.replace(/\s+/g, ' ').trim();

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Every block of a page, fingerprinted, in order. */
export function fingerprint(text: string): string[] {
  return blocksOf(text).map(hashBlock);
}

export interface PageComparison {
  /** Blocks in the new reading that were also in the old one. */
  unchanged: number;
  /** Blocks in the new reading. */
  total: number;
  /** Blocks that were there before and are not now. */
  gone: number;
  /** `unchanged / total`, 0 to 1. One means nothing new was read. */
  ratio: number;
  /** Whether the two readings are the same set of blocks. */
  identical: boolean;
  /**
   * Whether anything was stored for this page before.
   *
   * Distinguishes "nothing of this was already stored" from "this page has
   * never been read", which are different facts and want different words. A
   * news front page that changed completely is the first, and reporting nothing
   * for it would hide the most useful thing the comparison knows.
   */
  hadPrevious: boolean;
}

/**
 * How much of a new reading was already known.
 *
 * Measured against the new reading rather than against the union, so the number
 * answers the question actually being asked - how much of what I am about to
 * store do I already have. A page that lost a section without gaining one still
 * reports everything present as known, which is right: nothing new arrived.
 *
 * Duplicates within one page are counted once. A repeated boilerplate paragraph
 * is one block either way, and counting it twice would report a page as more
 * unchanged than it is.
 */
export function comparePages(previous: string[], next: string[]): PageComparison {
  const before = new Set(previous);
  const after = new Set(next);

  let unchanged = 0;
  for (const hash of after) if (before.has(hash)) unchanged++;

  let gone = 0;
  for (const hash of before) if (!after.has(hash)) gone++;

  const total = after.size;

  return {
    unchanged,
    total,
    gone,
    ratio: total === 0 ? 0 : unchanged / total,
    identical: total > 0 && unchanged === total && gone === 0,
    hadPrevious: before.size > 0,
  };
}
