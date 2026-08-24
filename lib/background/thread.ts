/**
 * The scrollback index.
 *
 * The panel discards its DOM and rebuilds from storage on every tab switch, so
 * something has to say which turns belong to this tab and in what order.
 *
 * The window pool cannot answer that. Eviction moves older turns into the
 * shared archive, so reading the window would show a conversation quietly
 * losing its beginning while the model could still recall it.
 *
 * So the thread pool holds ids, in order, and never evicts. Ids survive the
 * move — liminal ids are unique across every pool and `moveTo` carries them
 * over — so an id recorded here resolves wherever the turn now lives. A list of
 * ids for a year of browsing is a few hundred kilobytes.
 */

/**
 * A page read.
 *
 * `content` is the text and is only present while the page is the one held in
 * a tab's context pool. What a turn records is the title and address alone —
 * enough to say which page a question was asked against, without a second copy
 * of text that already lives in the pool and then in `scraped`.
 */
export interface PageContext {
  title?: string;
  url?: string;
  content?: string;
}

/** One entry as the panel renders it. */
export interface ThreadTurn {
  id: string;
  query: string;
  /** Null while the turn is still open, which the panel shows as pending. */
  response: string | null;
  seq: number;
  /** Title and url of a page read on this turn, if there was one. */
  page?: { title: string; url: string };
}

const THREAD_POOL = 'thread';

/**
 * Add any turns not yet indexed.
 *
 * Called after every turn, and idempotent, which is what makes it correct
 * rather than clever. Recording on completion alone would lose a turn that
 * threw or hit the iteration cap — but `turn()` closes those too, with
 * `stopped: "error"`, so they are in the window pool either way and this picks
 * them up. A conversation with a hole where a failed question used to be is
 * worse than one showing a question that went nowhere.
 *
 * It reads the window rather than being told an id, so it cannot be given the
 * wrong one, and a caller that forgets to await it only delays the index by one
 * turn instead of corrupting it.
 */
export async function syncThread(scope: any): Promise<void> {
  try {
    const pool = scope.ensurePool(THREAD_POOL);

    const known = new Set<string>(
      pool
        .list()
        .map((entry: any) => entry.content?.turnId)
        .filter(Boolean),
    );

    for (const turn of scope.getTurns()) {
      if (known.has(turn.id)) continue;
      await pool.create({ content: { turnId: turn.id, seq: turn.seq } });
    }
  } catch (error) {
    // Losing an index entry costs scrollback, not the conversation.
    console.warn('[thread] could not record turns:', error);
  }
}

/**
 * The conversation, oldest first, resolving each id wherever it lives now.
 *
 * A missing id is skipped rather than treated as an error. Anything whose pool
 * disposition is `drop()` rather than `moveTo()` leaves memory entirely while
 * its id stays here, which is expected rather than broken.
 */
export async function readThread(scope: any): Promise<ThreadTurn[]> {
  const convo = scope.convo ?? scope._convo;
  const index = scope.ensurePool(THREAD_POOL).list();

  const turns: ThreadTurn[] = [];

  for (const entry of index) {
    // `seq` comes from the index entry, not the turn node. The raw node holds
    // only `{ query, response }` — `seq` is on the parsed record, and reading
    // it from the node gave every turn a seq of 0, so ordering was silently
    // falling back to a stable sort over equal keys.
    const { turnId, seq } = entry.content ?? {};
    if (!turnId) continue;

    const node = convo?.memory?.get?.(turnId);
    if (!node) continue;

    const record = node.content ?? {};
    const page = record.context as PageContext | undefined;

    turns.push({
      id: turnId,
      query: String(record.query ?? ''),
      response: record.response ?? null,
      seq: Number(seq ?? 0),
      ...(page?.title || page?.url
        ? { page: { title: page.title ?? '', url: page.url ?? '' } }
        : {}),
    });
  }

  return turns.sort((a, b) => a.seq - b.seq);
}
