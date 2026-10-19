export type RushParams = {
  eventId: string;
  buyers: number;
  maxSeatsPerBuyer: number;
  durationSeconds: number;
  abandonRate?: number;
  thinkMs?: [number, number];
  maxInFlight?: number;
};

export type Counters = {
  started: number;
  queued: number;
  /** Buyers who had to re-join the waiting room after `queue_required` or an `unknown` queue state. */
  requeued: number;
  admitted: number;
  holdsOk: number;
  holdsConflict: number;
  paid: number;
  declined: number;
  abandoned: number;
  expired: number;
  soldOut: number;
  errors: number;
};
export type RunStatus = 'running' | 'finished' | 'stopped' | 'failed';
export type RunStats = {
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  params: RushParams;
  counters: Counters;
  latencyMs: { holdP50: number; holdP95: number; payP50: number; payP95: number };
  requests: number;
};

/** Nearest-rank percentile of a sample; the sample is sorted here, an empty one gives 0. */
export function percentile(sample: readonly number[], p: number): number {
  if (sample.length === 0) return 0;
  const sorted = [...sample].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

const zero = (): Counters => ({
  started: 0, queued: 0, requeued: 0, admitted: 0, holdsOk: 0, holdsConflict: 0, paid: 0, declined: 0, abandoned: 0, expired: 0, soldOut: 0, errors: 0,
});

/** Single-threaded JS makes each increment atomic; the object keeps every figure of one run in one place. */
export function createStats(params: RushParams, startedAt: Date) {
  const counters = zero();
  const holdMs: number[] = [];
  const payMs: number[] = [];
  let requests = 0;
  return {
    counters,
    inc(name: keyof Counters): void {
      counters[name]++;
    },
    recordHold: (ms: number): void => void holdMs.push(ms),
    recordPay: (ms: number): void => void payMs.push(ms),
    request: (): void => void requests++,
    snapshot(status: RunStatus, finishedAt?: Date): RunStats {
      return {
        status,
        startedAt: startedAt.toISOString(),
        ...(finishedAt ? { finishedAt: finishedAt.toISOString() } : {}),
        params,
        counters: { ...counters },
        latencyMs: {
          holdP50: percentile(holdMs, 0.5), holdP95: percentile(holdMs, 0.95),
          payP50: percentile(payMs, 0.5), payP95: percentile(payMs, 0.95),
        },
        requests,
      };
    },
  };
}
export type RunStatsRecorder = ReturnType<typeof createStats>;
