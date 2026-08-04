// split events into request-sized batches so a first run over months of
// transcript history doesn't send one enormous body — the server caps
// batch size on /api/v1/ingest.

export function chunkEvents<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive')
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}
