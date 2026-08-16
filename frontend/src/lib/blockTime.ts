import { publicClient } from "./chain";

/**
 * Wall-clock times for blocks, fetched lazily and cached forever.
 *
 * Nothing else in the app asks the chain what time it is — countdowns run off
 * the browser clock and prices carry their own timestamps. A settlement
 * timeline is the first thing that needs to say when something actually
 * happened, and the only honest source for that is the block itself.
 *
 * The cache never evicts because a mined block's timestamp cannot change. It
 * lives at module scope rather than in React state so it survives navigation:
 * leaving the page and coming back should not re-fetch two hundred blocks.
 */
const cache = new Map<bigint, number>();

/** Blocks already known. Safe to read every render. */
export function knownBlockTimes(): ReadonlyMap<bigint, number> {
  return cache;
}

/**
 * Fill in timestamps for blocks that need them, newest first.
 *
 * Capped per call on purpose. A cold load with two hundred historical
 * settlements must not fire two hundred `eth_getBlockByNumber` calls at an RPC
 * this project already documents as flaky — the rows fill in over the next few
 * ticks instead, and a missing time renders as the block number rather than as
 * a guess.
 *
 * @returns the cache, so a caller can pass it straight to `buildPipelines`.
 */
export async function fetchBlockTimes(
  blocks: Iterable<bigint>,
  max = 8,
): Promise<ReadonlyMap<bigint, number>> {
  const missing = [...new Set(blocks)].filter((b) => !cache.has(b));
  if (missing.length === 0) return cache;

  // Newest first: the rows a viewer is looking at during a demo are the ones
  // that just happened.
  missing.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));

  await Promise.all(
    missing.slice(0, max).map(async (blockNumber) => {
      try {
        const block = await publicClient.getBlock({ blockNumber });
        cache.set(blockNumber, Number(block.timestamp));
      } catch {
        // Decoration, not evidence. A block whose timestamp will not load just
        // shows as a block number, and the next tick tries again.
      }
    }),
  );

  return cache;
}
