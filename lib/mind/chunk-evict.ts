/**
 * What becomes of a page when the next one replaces it.
 *
 * The library ships `moveTo`, which carries nodes into another pool unchanged.
 * That is right for a turn and wrong for a page: a whole page in the archive is
 * one document that matches almost any question by surface area, and recalling
 * it means spending the entire memory budget to answer something addressed by
 * one paragraph of it.
 *
 * So a page is cut up on the way out. One node in, many nodes out, each a
 * finished piece of text carrying the page it came from. Recall can then return
 * the paragraph that matched rather than the document that contained it.
 *
 * Ids are not preserved here, and that is the difference from `moveTo`. A turn
 * keeps its id because other records point at it; a page fragment is new and
 * has nothing referring to it. The original page node's id dies with it.
 */
import { chunkPage } from './chunk';

/** Eviction context, as the library hands it to an `onEvict` hook. */
interface EvictContext {
  archive?: string;
  pool?: string;
  poolFor?: (name: string) => any;
  convo?: { memory: { pool: (name: string) => any } };
}

/**
 * Cut departing pages into pieces and file them in `target`.
 *
 * Anything that does not look like a page is passed through whole. The context
 * pool holds `*`, so nothing structurally stops something else being put there,
 * and silently dropping it would be the worst possible response to that.
 */
export function chunkTo(target: string) {
  return async function chunkDeparting(nodes: any[], ctx: EvictContext): Promise<void> {
    const to = target ?? ctx.archive;
    if (!to || to === ctx.pool) return;

    const pool = ctx.poolFor ? ctx.poolFor(to) : ctx.convo?.memory.pool(to);
    if (!pool) return;

    const items: any[] = [];

    for (const node of nodes) {
      const page = node?.content ?? {};
      const chunks = chunkPage(page);

      if (chunks.length === 0) {
        // Not a page, or a page with no text in it.
        if (typeof page.content !== 'string') {
          items.push({ content: node.content, tags: node.tags, metadata: node.metadata });
        }
        continue;
      }

      for (const chunk of chunks) {
        items.push({
          // The bare string, not `{ text }`.
          content: chunk.text,
          metadata: {
            kind: 'note',
            pageTitle: page.title ?? null,
            pageUrl: page.url ?? null,
            part: chunk.part,
            of: chunk.of,
            readAt: node?.metadata?.readAt ?? node?.metadata?.createdAt ?? Date.now(),
            // Which blocks of the page this piece covers.
            blocks: chunk.blocks,
          },
        });
      }
    }

    if (items.length > 0) await pool.createMany(items);
  };
}
