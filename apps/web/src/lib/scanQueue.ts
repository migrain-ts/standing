/**
 * Runs scans one at a time in submission order. A code identical to the one in flight or already queued is
 * dropped (a wedge scanner double-send, or a camera still seeing the same QR). A failing run never blocks the queue.
 */
export function createScanQueue(run: (code: string) => Promise<void>): (code: string) => void {
  const pending: string[] = [];
  let inFlight: string | null = null;
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
        inFlight = next;
        try {
          await run(next);
        } catch {
          // the caller records failures itself; keep draining
        }
        inFlight = null;
      }
    } finally {
      inFlight = null;
      draining = false;
    }
  };

  return (code) => {
    if (code === inFlight || pending.includes(code)) return;
    pending.push(code);
    void drain();
  };
}
