import { CheckLineIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** The one number that must stay 0. Status is carried by text, icon and colour together. */
export function OversoldBadge({ oversold }: { oversold: number }) {
  const ok = oversold === 0;
  return (
    <section
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border-2 bg-card p-5 md:p-6',
        ok ? 'border-success' : 'border-destructive motion-safe:animate-pulse',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-14 shrink-0 items-center justify-center rounded-full text-3xl font-semibold',
          ok ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground',
        )}
      >
        {ok ? <CheckLineIcon className="size-8" /> : '!'}
      </span>
      <div>
        <p id="oversold-label" className="text-sm font-medium text-muted-foreground">
          Oversold
        </p>
        <output
          aria-labelledby="oversold-label"
          data-testid="oversold"
          className={cn('block text-6xl font-semibold tabular-nums leading-none tracking-tight md:text-7xl', ok ? 'text-success' : 'text-destructive')}
        >
          {oversold}
        </output>
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">
        <span className={cn('font-medium', ok ? 'text-success' : 'text-destructive')}>{ok ? 'No seat sold twice.' : 'Seats sold more than once.'}</span>{' '}
        Computed in SQL: tickets issued minus seats sold
      </p>
    </section>
  );
}
