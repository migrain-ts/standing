export type SectionSpec = { name: string; rows: number; seatsPerRow: number };
export type SeatSpec = {
  sectionIndex: number;
  idx: number;
  rowLabel: string;
  number: number;
  x: number;
  y: number;
};

export const SEAT_PITCH = 20;
export const SECTION_GAP = 60;
export const STAGE_HEIGHT = 80;

export function rowLabelFor(row: number): string {
  let n = row;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Lays sections out left to right below a stage area; seat idx is stable and consecutive across sections. */
export function generateLayout(sections: readonly SectionSpec[]): SeatSpec[] {
  const seats: SeatSpec[] = [];
  let originX = 0;
  let idx = 0;
  sections.forEach((section, sectionIndex) => {
    for (let r = 0; r < section.rows; r++) {
      for (let c = 0; c < section.seatsPerRow; c++) {
        seats.push({
          sectionIndex,
          idx: idx++,
          rowLabel: rowLabelFor(r),
          number: c + 1,
          x: originX + c * SEAT_PITCH,
          y: STAGE_HEIGHT + r * SEAT_PITCH,
        });
      }
    }
    originX += section.seatsPerRow * SEAT_PITCH + SECTION_GAP;
  });
  return seats;
}
