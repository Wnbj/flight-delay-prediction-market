import { useCallback, useEffect, useRef, useState } from "react";
import {
  logId,
  readSettlementLogs,
  type LogFamily,
  type SettlementLog,
} from "../lib/settlementEvents";
import { buildPipelines, type Pipelines } from "../lib/pipeline";
import { fetchBlockTimes } from "../lib/blockTime";
import type { LpEvent, Market } from "../lib/types";

/**
 * Watches Sepolia for settlement activity and keeps a fold of it current.
 *
 * Mounted only by the page that shows it, not by `App` — a visitor reading the
 * markets list should not be polling anything. Same reasoning as the comment on
 * `useNow`: a tick belongs to whoever needs it.
 */

const POLL_MS = 6_000;

/**
 * How far back each incremental read reaches.
 *
 * `logsInChunks` hands its upper bound to the serving node rather than naming a
 * block, deliberately — these RPCs sit behind a load balancer and a node that
 * is behind will reject a range that runs past its own head. The consequence is
 * that we cannot know exactly how far a scan got, so the cursor is a hint and
 * this overlap is what absorbs the error. It also covers shallow reorgs.
 */
const OVERLAP = 16n;

export interface SettlementFeed extends Pipelines {
  /** Head as of the last completed read. */
  head: bigint;
  /** Epoch ms of the last completed read, for showing the page is alive. */
  lastPollAt: number | null;
  failures: { family: LogFamily; message: string }[];
  loading: boolean;
}

export function useSettlementFeed(markets: Market[], lpEvents: LpEvent[]): SettlementFeed {
  const [logs, setLogs] = useState<SettlementLog[]>([]);
  const [head, setHead] = useState<bigint>(0n);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [failures, setFailures] = useState<{ family: LogFamily; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [times, setTimes] = useState<ReadonlyMap<bigint, number>>(new Map());

  /** Held in a ref, not state: reading it must not re-arm the interval. */
  const store = useRef(new Map<string, SettlementLog>());
  const cursor = useRef<bigint | null>(null);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    // One read at a time. A slow response must not stack up behind the timer.
    if (busy.current) return;
    busy.current = true;
    try {
      const from = cursor.current;
      const scan = await readSettlementLogs(from === null ? {} : { from });

      /**
       * REPLACE THE WINDOW, do not union it.
       *
       * A union looks identical until a reorg, at which point a log that no
       * longer exists stays on screen forever — `getLogs` will never mention it
       * again to correct us. Dropping everything at or above the scanned floor
       * and reinserting what came back makes the visible state exactly what the
       * chain currently says.
       */
      const floor = from ?? 0n;
      for (const [id, l] of store.current) {
        if (l.blockNumber >= floor) store.current.delete(id);
      }
      for (const l of scan.logs) store.current.set(logId(l), l);

      const next = [...store.current.values()];
      setLogs(next);
      setHead(scan.head);
      setFailures(scan.failures);
      setLastPollAt(Date.now());

      // The cursor may only advance when nothing failed. A family that errored
      // has not been read for this window, and moving past it would lose those
      // logs permanently rather than retrying them.
      if (scan.failures.length === 0) {
        const maxSeen = next.reduce((m, l) => (l.blockNumber > m ? l.blockNumber : m), scan.head);
        const back = maxSeen > OVERLAP ? maxSeen - OVERLAP : 0n;
        cursor.current = back;
      }

      // Only blocks that will actually be rendered, newest first, capped.
      const wanted = next.flatMap((l) =>
        l.kind === "requested" || l.kind === "report" || l.kind === "settled"
          ? [l.blockNumber]
          : [],
      );
      setTimes(new Map(await fetchBlockTimes(wanted)));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      // A backgrounded tab stops reading, exactly as the spot poller does.
      if (document.hidden || stopped) return;
      void poll();
    };

    void poll();
    const timer = setInterval(tick, POLL_MS);

    // Catching up immediately on return is not needed for correctness — the
    // cursor does not move while hidden, so the next tick simply reads a wider
    // window — but a tab left in the background should not sit stale for six
    // seconds in front of an audience.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const pipelines = buildPipelines(markets, logs, lpEvents, new Map(times));

  return { ...pipelines, head, lastPollAt, failures, loading };
}
