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
 * The completed turn is named directly as well as swept for, because eviction
 * runs inside `completeTurn` and can move a turn out of the window before this
 * ever looks at it. See the note in the body.
 */
export async function syncThread(scope: any, record?: { id: string; seq?: number }): Promise<void> {
  try {
    const pool = scope.ensurePool(THREAD_POOL);

    const known = new Set<string>(
      pool
        .list()
        .map((entry: any) => entry.content?.turnId)
        .filter(Boolean),
    );

    /*
      The turn just completed is passed in, because reading the window is not
      enough to find it.

      `getTurns()` lists the window pool, and `completeTurn` runs eviction
      before returning — so a turn that pushed the window over its budget is
      already in the archive by the time this looks, and would never be
      indexed. Not a rare case either: it is guaranteed for every turn once a
      conversation reaches its budget, and the result is a scrollback that
      silently stops growing while the model can still recall everything in it.

      Naming the turn directly closes that hole. The window sweep stays for
      anything else that arrived without passing through here.
    */
    if (record?.id && !known.has(record.id)) {
      known.add(record.id);
      await pool.create({ content: { turnId: record.id, seq: record.seq ?? 0 } });
    }

    let added = record?.id ? 1 : 0;

    for (const turn of scope.getTurns()) {
      if (known.has(turn.id)) continue;
      known.add(turn.id);
      added++;
      await pool.create({ content: { turnId: turn.id, seq: turn.seq } });
    }

    /*
      Written to disk explicitly, because nothing else will do it.

      These go in through the pool directly rather than through the
      conversation, and only the conversation's own writes trigger its autosave
      — so every entry here lived in memory and died with the worker. The
      scrollback was intact for as long as you kept the browser open and empty
      the moment you did not, which reads exactly like a conversation that was
      never saved even though the turns themselves were.
    */
    if (added > 0) await (scope.convo ?? scope._convo)?.persist?.();
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
