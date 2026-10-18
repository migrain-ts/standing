/** Pure seat-map geometry and status helpers. No DOM access: the canvas component feeds these. */
export type VenueMap = {
  sections: { id: string; name: string; ord: number }[];
  seats: [x: number, y: number, sectionOrd: number, row: string, number: number][];
  seatIds: string[];
  width: number;
  height: number;
};
export type Availability = { at: string; held: number[]; sold: number[] };
export type Status = 'free' | 'held' | 'sold' | 'selected' | 'mine';
export type View = { scale: number; offsetX: number; offsetY: number };

/** Precedence: sold, mine, selected, held, free. */
export function statusArray(
  count: number,
  availability: { held: readonly number[]; sold: readonly number[] },
  selected: ReadonlySet<number>,
  mine: ReadonlySet<number>,
): Status[] {
  const out: Status[] = Array.from({ length: count }, () => 'free');
  for (const i of availability.held) if (i >= 0 && i < count) out[i] = 'held';
  for (const i of selected) if (i >= 0 && i < count) out[i] = 'selected';
  for (const i of mine) if (i >= 0 && i < count) out[i] = 'mine';
  for (const i of availability.sold) if (i >= 0 && i < count) out[i] = 'sold';
  return out;
}

/** Nearest seat idx within `radius` screen pixels of (px, py), else null. */
export function hitTest(seats: VenueMap['seats'], view: View, px: number, py: number, radius = 8): number | null {
  let best: number | null = null;
  let bestD = radius * radius;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (!s) continue;
    const dx = s[0] * view.scale + view.offsetX - px;
    const dy = s[1] * view.scale + view.offsetY - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const SEAT_HALF = 8;
const MARGIN = 16;
const STAGE_TOP = 0;

/** Scale and centre so every seat (plus the stage band above them) sits inside the canvas with a margin. */
export function fitView(map: Pick<VenueMap, 'seats'>, width: number, height: number): View {
  if (map.seats.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of map.seats) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX + 1;
  const h = maxY - STAGE_TOP + 1;
  const availW = Math.max(1, width - 2 * (MARGIN + SEAT_HALF));
  const availH = Math.max(1, height - 2 * (MARGIN + SEAT_HALF));
  const scale = Math.min(availW / w, availH / h, 4);
  return {
    scale,
    offsetX: (width - (maxX + minX) * scale) / 2,
    offsetY: (height - (maxY + STAGE_TOP) * scale) / 2,
  };
}

/** Opacity of a free seat's section colour (the 1px outline stays at full strength). */
export const FREE_ALPHA = 0.75;
export const SECTION_COLOURS = 5;

/** Categorical section token (`--section-1` to `--section-5`), wrapping after five sections. */
export function sectionToken(ord: number): string {
  return `--section-${(((ord % SECTION_COLOURS) + SECTION_COLOURS) % SECTION_COLOURS) + 1}`;
}

/** Free seats grouped by section and row, as "1-3, 5" ranges: the text twin of the canvas. */
export function freeSeatSummary(
  seats: VenueMap['seats'],
  status: readonly Status[],
): { sectionOrd: number; row: string; seats: string }[] {
  const groups = new Map<string, { sectionOrd: number; row: string; nums: number[] }>();
  seats.forEach((s, i) => {
    if (status[i] !== 'free') return;
    const key = `${s[2]}|${s[3]}`;
    const g = groups.get(key) ?? { sectionOrd: s[2], row: s[3], nums: [] };
    g.nums.push(s[4]);
    groups.set(key, g);
  });
  return [...groups.values()].map((g) => {
    const nums = g.nums.sort((a, b) => a - b);
    const parts: string[] = [];
    let start = nums[0] ?? 0;
    let prev = start;
    for (const n of [...nums.slice(1), Infinity]) {
      if (n !== prev + 1) {
        parts.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = n;
      }
      prev = n;
    }
    return { sectionOrd: g.sectionOrd, row: g.row, seats: parts.join(', ') };
  });
}
