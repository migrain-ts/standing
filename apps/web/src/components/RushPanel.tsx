'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { RUSH_DEFAULTS, RUSH_SLIDER, describeRun, validateRush, type RushForm, type RushRunView } from '@/lib/rush';

export type RushControl = {
  run: RushRunView | null;
  /** Why starting is impossible right now (event not published, simulator down), else null. */
  blockedReason: string | null;
  pending: boolean;
  error: string | null;
  onStart: (form: RushForm) => void;
  onStop: () => void;
};

const nf = new Intl.NumberFormat('en-IE');

function Counters({ run }: { run: RushRunView }) {
  const c = run.counters;
  const items: [string, number][] = [
    ['Queued', c.queued],
    ['Holds ok', c.holdsOk],
    ['Conflicts (409)', c.holdsConflict],
    ['Paid', c.paid],
    ['Declined', c.declined],
    ['Sold out', c.soldOut],
    ['Re-queued', c.requeued],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {items.map(([label, n]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{nf.format(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SliderRow({ id, label, value, unit, field, onChange, disabled }: {
  id: string; label: string; value: number; unit: string; field: keyof RushForm; onChange: (v: number) => void; disabled: boolean;
}) {
  const { min, max, step } = RUSH_SLIDER[field];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id}>{label}</span>
        <span className="tabular-nums font-medium">{nf.format(value)}{unit}</span>
      </div>
      <Slider
        aria-labelledby={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? value) : v)}
        className="[&>div]:min-h-11 md:[&>div]:min-h-8"
      />
    </div>
  );
}

/** Rush control: sliders, Start Rush, then live counters, Stop and the final result. */
export function RushPanel({ control }: { control: RushControl }) {
  const [form, setForm] = useState<RushForm>(RUSH_DEFAULTS);
  const running = control.run?.status === 'running';
  const valid = validateRush(form);
  const reason = control.blockedReason ?? (running ? 'A run is already in progress.' : null);
  const disabled = reason !== null || control.pending || !valid.ok;
  const view = control.run ? describeRun(control.run) : null;
  const set = (k: keyof RushForm) => (v: number) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Simulated buyers join the waiting room, hold seats and pay with the simulated gateway.</p>
      <div className="space-y-2">
        <SliderRow id="rush-buyers" label="Buyers" value={form.buyers} unit="" field="buyers" onChange={set('buyers')} disabled={running} />
        <SliderRow id="rush-seats" label="Seats per buyer" value={form.maxSeatsPerBuyer} unit="" field="maxSeatsPerBuyer" onChange={set('maxSeatsPerBuyer')} disabled={running} />
        <SliderRow id="rush-duration" label="Duration" value={form.durationSeconds} unit=" s" field="durationSeconds" onChange={set('durationSeconds')} disabled={running} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-11 md:h-10" disabled={disabled} aria-describedby={reason ? 'rush-reason' : undefined} onClick={() => valid.ok && control.onStart(valid.value)}>
          Start Rush
        </Button>
        {running && (
          <Button variant="outline" className="h-11 md:h-10" onClick={control.onStop}>
            Stop
          </Button>
        )}
      </div>
      {reason && (
        <p id="rush-reason" className="text-sm text-muted-foreground">
          {reason}
        </p>
      )}
      {control.error && (
        <p role="alert" className="text-sm text-destructive">
          {control.error}
        </p>
      )}
      {control.run && view && (
        <div className="space-y-4 border-t border-border pt-4" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium">{view.label}</p>
            <p className="text-sm tabular-nums text-muted-foreground">{view.rate} requests/s</p>
          </div>
          <Progress value={Math.round(view.progress * 100)} aria-label="Rush progress" className="h-2" />
          <Counters run={control.run} />
        </div>
      )}
    </div>
  );
}
