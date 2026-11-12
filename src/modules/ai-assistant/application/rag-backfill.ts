export const BACKFILL_SOURCES = [
  'resort',
  'article',
  'project_doc',
  'dynamic',
  'dictionary',
] as const;
export type BackfillSource = (typeof BACKFILL_SOURCES)[number];
export interface BackfillReader {
  upperBound(source: BackfillSource): Promise<number>;
  page(
    source: BackfillSource,
    afterId: number,
    upperBound: number,
    limit: number,
  ): Promise<number[]>;
}
export interface BackfillOptions {
  sources: readonly BackfillSource[];
  afterId: number;
  batchSize: number;
}

export function parseBackfillOptions(args: readonly string[]): BackfillOptions {
  let sources: readonly BackfillSource[] = BACKFILL_SOURCES;
  let afterId = 0;
  let batchSize = 100;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    const value = args[index + 1];
    if (seen.has(key) || !value)
      throw new TypeError('Duplicate or missing backfill option');
    seen.add(key);
    switch (key) {
      case '--source':
        if (
          value !== 'all' &&
          !BACKFILL_SOURCES.includes(value as BackfillSource)
        )
          throw new TypeError('Unknown backfill source');
        sources =
          value === 'all' ? BACKFILL_SOURCES : [value as BackfillSource];
        break;
      case '--after-id':
        afterId = integer(value, 0, 2_147_483_647);
        break;
      case '--batch-size':
        batchSize = integer(value, 1, 500);
        break;
      default:
        throw new TypeError('Unknown backfill option');
    }
  }
  if (afterId > 0 && sources.length !== 1)
    throw new TypeError('Resume requires a single source');
  return { sources, afterId, batchSize };
}

function integer(value: string, min: number, max: number): number {
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  )
    throw new TypeError('Invalid backfill numeric option');
  return number;
}

export class RagBackfillFailure extends Error {
  constructor(
    readonly source: BackfillSource,
    readonly id: number,
  ) {
    super(`RAG backfill failed: ${source}:${id}`);
  }
}

/** Replays current authoritative rows; never publishes fabricated Kafka events. */
export async function runRagBackfill(
  options: BackfillOptions,
  reader: BackfillReader,
  replay: (source: BackfillSource, id: number) => Promise<boolean>,
  progress: (source: BackfillSource, id: number) => void,
): Promise<number> {
  let processed = 0;
  for (const source of options.sources) {
    const upper = await reader.upperBound(source);
    let after = options.afterId;
    while (after < upper) {
      const ids = await reader.page(source, after, upper, options.batchSize);
      if (!ids.length) break;
      for (const id of ids) {
        if (!Number.isSafeInteger(id) || id <= after || id > upper)
          throw new Error('Invalid backfill page order');
        try {
          if (!(await replay(source, id)))
            throw new Error('Replay was not processed');
        } catch {
          // Provider/database errors may contain credentials or source contents.
          throw new RagBackfillFailure(source, id);
        }
        after = id;
        processed++;
        progress(source, id);
      }
    }
  }
  return processed;
}
