'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { validateEvent } from '@/lib/eventForm';
import type { VenueRow } from '@/lib/organizer';

export type NewEvent = { venueId: string; name: string; startsAt: string; admissionLimit: number };

function Err({ msg }: { msg?: string }) {
  return msg ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {msg}
    </p>
  ) : null;
}

export function EventForm({ venues, pending, onSubmit }: { venues: VenueRow[]; pending: boolean; onSubmit: (e: NewEvent) => void }) {
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [limit, setLimit] = useState('200');
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const next: Record<string, string> = {};
        if (!venueId) next['venueId'] = 'Choose a venue';
        const r = validateEvent({ name, startsAt, admissionLimit: limit.trim() === '' ? Number.NaN : Number(limit) }, new Date());
        if (!r.ok) Object.assign(next, r.errors);
        setErrors(next);
        if (r.ok && !next['venueId']) onSubmit({ venueId, ...r.value });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="event-venue">Venue</Label>
        <NativeSelect id="event-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} error={!!errors['venueId']} className="h-11 md:h-9">
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.seatCount.toLocaleString('en-IE')} seats)
            </option>
          ))}
        </NativeSelect>
        <Err msg={errors['venueId']} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-name">Event name</Label>
        <Input id="event-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors['name']} className="h-11 md:h-9" />
        <Err msg={errors['name']} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-start">Starts</Label>
        <Input id="event-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-invalid={!!errors['startsAt']} className="h-11 md:h-9" />
        <Err msg={errors['startsAt']} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-limit">Admission limit</Label>
        <Input id="event-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!!errors['admissionLimit']} aria-describedby="event-limit-help" className="h-11 md:h-9" />
        <p id="event-limit-help" className="text-xs text-muted-foreground">
          Buyers inside the sale at once, from 0 to 2000. The rest wait in the queue.
        </p>
        <Err msg={errors['admissionLimit']} />
      </div>
      <Button type="submit" className="h-11 w-full md:h-9 md:w-auto" disabled={pending}>
        Create draft
      </Button>
    </form>
  );
}
