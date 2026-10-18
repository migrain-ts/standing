import type { FormResult } from './venueForm';

export type EventFormInput = { name: string; startsAt: string; admissionLimit: number };
export type EventFormValue = { name: string; startsAt: string; admissionLimit: number };

/** `startsAt` is a datetime-local string (browser local time); the value carries an ISO instant. */
export function validateEvent(input: EventFormInput, now: Date): FormResult<EventFormValue> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) errors['name'] = 'Enter a name of 1 to 120 characters';
  const starts = input.startsAt ? new Date(input.startsAt) : null;
  if (!starts || Number.isNaN(starts.getTime())) errors['startsAt'] = 'Choose a date and time';
  else if (starts.getTime() <= now.getTime()) errors['startsAt'] = 'The event must start in the future';
  if (!Number.isInteger(input.admissionLimit) || input.admissionLimit < 0 || input.admissionLimit > 2000) {
    errors['admissionLimit'] = 'Enter a whole number from 0 to 2000';
  }
  if (Object.keys(errors).length > 0 || !starts) return { ok: false, errors };
  return { ok: true, value: { name, startsAt: starts.toISOString(), admissionLimit: input.admissionLimit } };
}

export function tiersComplete(sections: readonly { id: string }[], tiers: readonly { sectionId: string }[]): boolean {
  if (sections.length === 0) return false;
  const priced = new Set(tiers.map((t) => t.sectionId));
  return sections.every((s) => priced.has(s.id));
}

export type PublishCheck = { ok: true } | { ok: false; reason: string };

export function canPublish(
  event: { status: string; startsAt: string },
  sections: readonly { id: string }[],
  tiers: readonly { sectionId: string }[],
  now: Date,
): PublishCheck {
  if (event.status !== 'draft') return { ok: false, reason: 'Only draft events can be published' };
  if (new Date(event.startsAt).getTime() <= now.getTime()) return { ok: false, reason: 'Event date is in the past' };
  if (!tiersComplete(sections, tiers)) return { ok: false, reason: 'Set a price for every section' };
  return { ok: true };
}
