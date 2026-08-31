/**
 * Cutting a read page into pieces small enough to recall one at a time.
 *
 * A whole page is the wrong unit for recall. Twelve thousand characters match
 * almost any question by sheer surface area, and returning all of it to answer
 * something addressed by one paragraph spends the entire budget on a single
 * memory. Pieces let recall bring back the part that actually matched.
 *
 * The rule that governs everything here: a piece must end on a finished
 * thought. A fragment cut mid-sentence is worse than no fragment at all —
 * whatever it was about is missing exactly where it mattered, and the model
 * reads a confident half-statement with the qualifying half gone. So sentences
 * are never split. Pieces are built by packing whole sentences until the next
 * one would not fit, which makes every boundary a sentence boundary by
 * construction rather than by luck.
 *
 * Two things resist that and are handled rather than ignored. A single sentence
 * longer than the maximum has no interior boundary to use, so it is broken at a
 * word instead and marked as continuing. And headings, bullets, and table rows
 * carry no terminating punctuation at all, which is not a failure — a bullet is
 * already a whole thought, so the block boundary is the right cut.
 *
 * Every piece carries the page it came from. A recalled paragraph with no
 * source is a floating claim, and the model has no way to weigh it or say where
 * it learned it.
 */
import { blocksOf, hashBlock } from './blocks';

/** What a piece aims for. Big enough to hold an argument, small enough to rank. */
const TARGET_CHARS = 600;

/** Never exceeded except by one unbreakable sentence. */
const MAX_CHARS = 900;

/**
 * Below this a trailing piece is folded back into the one before it.
 *
 * A forty-character orphan ranks badly and reads as noise, and the page it
 * trails is nearly always better served by one slightly long piece.
 */
const MIN_CHARS = 200;

export interface PageChunk {
  /** The text, provenance line included, ready to store and index. */
  text: string;
  /** 1-based, for display. */
  part: number;
  /** How many pieces the page became. */
  of: number;
  /**
   * Fingerprints of the blocks this piece covers.
   *
   * Carried so a later reading of the same page can be compared against what is
   * already stored without keeping a second copy of the text to diff against.
   */
  blocks: string[];
}

export interface ChunkSource {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * Split a page into recallable pieces.
 *
 * Returns an empty array for a page with no text, which is a real case: the
 * extractor can come back empty on a page whose content never painted.
 */
export function chunkPage(page: ChunkSource): PageChunk[] {
  const body = (page?.content ?? '').trim();
  if (!body) return [];

  // Shared with the reread comparison, so the pieces being counted are always
  // the pieces being stored.
  const blocks = blocksOf(body);

  /*
    Each piece carries the fingerprints of the blocks that went into it.

    Tracked as the piece is built rather than recovered afterwards, because
    afterwards is guesswork: a heading is repeated onto continuation pieces and
    an over-long block is split across several, so the text of a finished piece
    no longer maps cleanly back onto the blocks it came from.
  */
  const pieces: { text: string; blocks: string[] }[] = [];
  let current = '';
  let currentBlocks: string[] = [];
  /** The last heading seen, repeated onto pieces that start mid-section. */
  let heading = '';
  let headingHash = '';

  const flush = () => {
    const text = current.trim();
    if (text) pieces.push({ text, blocks: [...new Set(currentBlocks)] });
    current = '';
    currentBlocks = [];
  };

  const add = (text: string, hash: string) => {
    const candidate = current ? `${current}\n\n${text}` : text;

    if (candidate.length <= MAX_CHARS) {
      current = candidate;
      currentBlocks.push(hash);
      if (current.length >= TARGET_CHARS) flush();
      return;
    }

    flush();
    // Repeat the section heading, so a piece taken from the middle of a section
    // still says what section it is.
    const repeats = heading && !text.startsWith('#');
    current = repeats ? `${heading}\n\n${text}` : text;
    currentBlocks = repeats && headingHash ? [headingHash, hash] : [hash];
    if (current.length >= TARGET_CHARS) flush();
  };

  for (const block of blocks) {
    const hash = hashBlock(block);

    if (/^#{1,6}\s/.test(block)) {
      heading = block;
      headingHash = hash;
      add(block, hash);
      continue;
    }

    if (block.length <= MAX_CHARS) {
      add(block, hash);
      continue;
    }

    // Every piece of an over-long block still belongs to that one block.
    for (const piece of splitLongBlock(block)) add(piece, hash);
  }

  flush();

  // Fold a runt tail back rather than storing it alone.
  if (pieces.length > 1) {
    const last = pieces[pieces.length - 1]!;
    if (last.text.length < MIN_CHARS) {
      const previous = pieces[pieces.length - 2]!;
      previous.text = `${previous.text}\n\n${last.text}`;
      previous.blocks = [...new Set([...previous.blocks, ...last.blocks])];
      pieces.pop();
    }
  }

  const source = sourceLine(page);

  return pieces.map((piece, index) => ({
    text: source ? `${source}\n\n${piece.text}` : piece.text,
    part: index + 1,
    of: pieces.length,
    blocks: piece.blocks,
  }));
}

/**
 * Break a block too long to store whole, at sentence boundaries.
 *
 * Sentences are packed until the next would overflow, so the cut always lands
 * after a terminator. A sentence that is itself over the maximum has no
 * boundary inside it and is broken at a word, which is the only case where a
 * piece ends mid-thought — marked with an ellipsis so it reads as continuing
 * rather than as a complete statement that happens to trail off.
 */
function splitLongBlock(block: string): string[] {
  const out: string[] = [];
  let current = '';

  for (const sentence of splitSentences(block)) {
    if (sentence.length > MAX_CHARS) {
      if (current) {
        out.push(current.trim());
        current = '';
      }
      out.push(...splitAtWords(sentence));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_CHARS) {
      if (current) out.push(current.trim());
      current = sentence;
      continue;
    }

    current = candidate;
    if (current.length >= TARGET_CHARS) {
      out.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * A block's sentences.
 *
 * The split is on terminating punctuation followed by whitespace and something
 * that starts a new sentence — a capital, a digit, or an opening quote. Testing
 * what comes next is what keeps "v1.2" and "google.com/a" in one piece, since
 * neither is followed by a sentence opening. Closing quotes and brackets are
 * kept with the sentence they end.
 *
 * Text with no terminator at all — a heading, a bullet, a table row — comes
 * back as one piece, which is correct: it is already one whole thought.
 */
function splitSentences(block: string): string[] {
  const parts = block.split(/(?<=[.!?][")'\]]?)\s+(?=["'(\[]?[A-Z0-9])/);

  /*
    Put back the splits that were not sentence ends after all.

    Requiring a capital next handles `v1.2` and `github.com/a`, because neither
    has one. It does nothing for `Dr. Smith` or `J. R. R. Tolkien`, where a
    capital is exactly what follows an abbreviation — so those are repaired here
    by looking at what precedes the break instead.
  */
  const joined: string[] = [];
  for (const part of parts) {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      joined[joined.length - 1] = `${previous} ${part}`;
      continue;
    }
    joined.push(part);
  }

  return joined.map((part) => part.trim()).filter(Boolean);
}

/**
 * Titles, single initials, and the handful of abbreviations that take a period
 * and are routinely followed by a capitalised word.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'mt',
  'inc',
  'ltd',
  'co',
  'corp',
  'dept',
  'est',
  'fig',
  'no',
  'vol',
  'ed',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
  'approx',
  'vs',
  'etc',
  'al',
  'cf',
]);

function endsWithAbbreviation(text: string): boolean {
  const match = /(?:^|\s)([A-Za-z.]{1,5})\.$/.exec(text.trimEnd());
  if (!match) return false;

  const word = match[1]!.toLowerCase();

  // A single letter is an initial: "J. R. R. Tolkien", "A. Smith".
  if (word.length === 1) return true;

  // A run of single letters with periods: "U.S.", "e.g.", "i.e.".
  if (/^(?:[a-z]\.)+[a-z]?$/.test(word)) return true;

  return ABBREVIATIONS.has(word.replace(/\./g, ''));
}

/** Last resort for a single sentence longer than a whole piece. */
function splitAtWords(sentence: string): string[] {
  const out: string[] = [];
  const words = sentence.split(/\s+/);
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_CHARS) {
      if (current) out.push(`${current} […]`);
      current = word;
      continue;
    }
    current = candidate;
  }

  if (current) out.push(current);
  return out;
}

/** Where a piece came from, so a recalled fragment is not a floating claim. */
function sourceLine(page: ChunkSource): string {
  const title = page?.title?.trim();
  const url = page?.url?.trim();

  if (title && url) return `From "${title}" (${url}):`;
  if (title) return `From "${title}":`;
  if (url) return `From ${url}:`;
  return '';
}
