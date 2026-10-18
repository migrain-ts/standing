import { generateLayout, MAX_SEATS_PER_VENUE, venueCreateSchema, type SeatSpec, type SectionSpec, type VenueCreateInput } from '@standing/shared';

/** Same text as the shared schema's refinement, so the form and the API say the same thing. */
export const SEAT_LIMIT_MESSAGE = `A venue holds at most ${MAX_SEATS_PER_VENUE} seats`;

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** Field-level messages keyed by dotted path ("name", "sections", "sections.0.rows"); first message per field wins. */
export function validateVenue(input: unknown): FormResult<VenueCreateInput> {
  const parsed = venueCreateSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || 'form';
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Seats of the generated map plus their total. Rows and seats per row are clamped so a half-typed form cannot freeze the tab. */
export function previewSeats(sections: readonly SectionSpec[]): { seats: SeatSpec[]; total: number } {
  const safe = sections.map((s) => ({
    name: s.name,
    rows: Number.isInteger(s.rows) ? Math.min(Math.max(s.rows, 0), 60) : 0,
    seatsPerRow: Number.isInteger(s.seatsPerRow) ? Math.min(Math.max(s.seatsPerRow, 0), 80) : 0,
  }));
  const seats = generateLayout(safe);
  return { seats, total: seats.length };
}
