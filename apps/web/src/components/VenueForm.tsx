'use client';
import { useMemo, useState } from 'react';
import { MAX_SEATS_PER_VENUE } from '@standing/shared';
import { VenuePreview } from '@/components/VenuePreview';
import { AddLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { previewSeats, validateVenue } from '@/lib/venueForm';
import type { VenueCreateInput } from '@standing/shared';

type Row = { name: string; rows: string; seatsPerRow: string };
const MAX_SECTIONS = 12;
const toNumber = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s));
const fmt = (n: number): string => n.toLocaleString('en-IE');

function Err({ id, msg }: { id: string; msg?: string }) {
  return msg ? (
    <p id={id} role="alert" className="mt-1 text-xs text-destructive">
      {msg}
    </p>
  ) : null;
}

export function VenueForm({ pending, onSubmit }: { pending: boolean; onSubmit: (v: VenueCreateInput) => void }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([{ name: 'Floor', rows: '10', seatsPerRow: '20' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const specs = rows.map((r) => ({ name: r.name, rows: toNumber(r.rows), seatsPerRow: toNumber(r.seatsPerRow) }));
  const preview = useMemo(() => previewSeats(rows.map((r) => ({ name: r.name, rows: toNumber(r.rows), seatsPerRow: toNumber(r.seatsPerRow) }))), [rows]);
  const over = preview.total > MAX_SEATS_PER_VENUE;

  const patch = (i: number, p: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const numberError = (key: string, value: number): string | undefined => (errors[key] && Number.isNaN(value) ? 'Enter a whole number' : errors[key]);

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const r = validateVenue({ name, sections: specs });
        if (r.ok) {
          setErrors({});
          onSubmit(r.value);
        } else setErrors(r.errors);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="venue-name">Venue name</Label>
        <Input id="venue-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors['name']} aria-describedby="venue-name-err" className="h-11 md:h-9" />
        <Err id="venue-name-err" msg={errors['name']} />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Sections</legend>
        {rows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`sec-name-${i}`}>Section {i + 1} name</Label>
                <Input id={`sec-name-${i}`} value={r.name} maxLength={50} onChange={(e) => patch(i, { name: e.target.value })} aria-invalid={!!errors[`sections.${i}.name`]} className="h-11 md:h-9" />
              </div>
              <Button type="button" variant="ghost" className="h-11 md:h-9" disabled={rows.length === 1} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
                Remove
                <span className="sr-only"> section {i + 1}</span>
              </Button>
            </div>
            <Err id={`sec-name-err-${i}`} msg={errors[`sections.${i}.name`]} />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`sec-rows-${i}`}>Rows (1 to 60)</Label>
                <Input id={`sec-rows-${i}`} inputMode="numeric" value={r.rows} onChange={(e) => patch(i, { rows: e.target.value })} aria-invalid={!!errors[`sections.${i}.rows`]} className="h-11 md:h-9" />
                <Err id={`sec-rows-err-${i}`} msg={numberError(`sections.${i}.rows`, specs[i]?.rows ?? 0)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`sec-seats-${i}`}>Seats per row (1 to 80)</Label>
                <Input id={`sec-seats-${i}`} inputMode="numeric" value={r.seatsPerRow} onChange={(e) => patch(i, { seatsPerRow: e.target.value })} aria-invalid={!!errors[`sections.${i}.seatsPerRow`]} className="h-11 md:h-9" />
                <Err id={`sec-seats-err-${i}`} msg={numberError(`sections.${i}.seatsPerRow`, specs[i]?.seatsPerRow ?? 0)} />
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" className="h-11 md:h-9" disabled={rows.length >= MAX_SECTIONS} onClick={() => setRows((cur) => [...cur, { name: `Section ${cur.length + 1}`, rows: '10', seatsPerRow: '20' }])}>
          <AddLineIcon className="size-4" aria-hidden />
          Add section
        </Button>
        <Err id="sections-err" msg={errors['sections']} />
      </fieldset>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span>Total seats</span>
          <span data-testid="seat-total" className={over ? 'font-medium text-destructive' : 'tabular-nums'}>
            {fmt(preview.total)} of {fmt(MAX_SEATS_PER_VENUE)}
          </span>
        </div>
        <Progress value={Math.min(100, (preview.total / MAX_SEATS_PER_VENUE) * 100)} aria-label="Seats used of the venue limit" className="h-2" />
        <VenuePreview seats={preview.seats} label={`Preview of the seat map, ${preview.total} seats in ${rows.length} sections`} />
      </div>

      <Button type="submit" className="h-11 w-full md:h-9 md:w-auto" disabled={pending}>
        Create venue
      </Button>
    </form>
  );
}
