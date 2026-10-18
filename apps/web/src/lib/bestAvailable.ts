import type { Status, VenueMap } from './seatmap';

type RowSeat = { idx: number; num: number };

const rowRank = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/**
 * Lowest row with `count` consecutive free seats in one section, the run nearest the row centre.
 * Otherwise the `count` free seats nearest the best single seat. Empty when fewer than `count` are free.
 */
export function bestAvailable(seats: VenueMap['seats'], status: readonly Status[], count: number, preferSection?: number): number[] {
  if (count < 1) return [];
  const rows = new Map<string, { section: number; row: string; all: RowSeat[]; free: RowSeat[] }>();
  let freeTotal = 0;
  seats.forEach((s, idx) => {
    const key = `${s[2]}|${s[3]}`;
    const r = rows.get(key) ?? { section: s[2], row: s[3], all: [], free: [] };
    r.all.push({ idx, num: s[4] });
    if (status[idx] === 'free') {
      r.free.push({ idx, num: s[4] });
      freeTotal++;
    }
    rows.set(key, r);
  });
  if (freeTotal < count) return [];

  const ordered = [...rows.values()].sort((a, b) => rowRank(a.row, b.row) || a.section - b.section);
  const findRun = (only?: number): number[] | null => {
    for (const r of ordered) {
      if (only !== undefined && r.section !== only) continue;
      const free = r.free.sort((a, b) => a.num - b.num);
      const centre = (r.all.reduce((m, s) => Math.min(m, s.num), Infinity) + r.all.reduce((m, s) => Math.max(m, s.num), -Infinity)) / 2;
      let best: RowSeat[] | null = null;
      let bestD = Infinity;
      for (let i = 0; i + count <= free.length; i++) {
        const w = free.slice(i, i + count);
        const first = w[0];
        const last = w[count - 1];
        if (!first || !last || last.num - first.num !== count - 1) continue;
        const d = Math.abs((first.num + last.num) / 2 - centre);
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
      if (best) return best.map((s) => s.idx);
    }
    return null;
  };
  const run = (preferSection !== undefined ? findRun(preferSection) : null) ?? findRun();
  if (run) return run;

  // Fallback: anchor on the best single free seat, take the nearest free seats around it.
  const pool = preferSection !== undefined && ordered.filter((r) => r.section === preferSection).reduce((n, r) => n + r.free.length, 0) >= count
    ? ordered.filter((r) => r.section === preferSection)
    : ordered;
  const anchorRow = pool.find((r) => r.free.length > 0);
  if (!anchorRow) return [];
  const centre = (anchorRow.all.reduce((m, s) => Math.min(m, s.num), Infinity) + anchorRow.all.reduce((m, s) => Math.max(m, s.num), -Infinity)) / 2;
  const anchor = [...anchorRow.free].sort((a, b) => Math.abs(a.num - centre) - Math.abs(b.num - centre) || a.num - b.num)[0];
  const anchorSeat = anchor ? seats[anchor.idx] : undefined;
  if (!anchor || !anchorSeat) return [];
  const candidates = pool.flatMap((r) => r.free.map((f) => f.idx));
  const dist = (i: number) => {
    const s = seats[i];
    return s ? (s[0] - anchorSeat[0]) ** 2 + (s[1] - anchorSeat[1]) ** 2 : Infinity;
  };
  return candidates
    .sort((a, b) => dist(a) - dist(b) || a - b)
    .slice(0, count)
    .sort((a, b) => a - b);
}
