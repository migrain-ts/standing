import { AddLineIcon, CheckLineIcon, ScanLineIcon } from '@/components/icons';
import type { ScanTone, ScanView } from '@/lib/scanResult';
import { cn } from '@/lib/utils';

const TONE: Record<ScanTone, string> = {
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  danger: 'bg-destructive text-white',
};

/** Icon (never colour alone) inside a ring that follows the tone's text colour. */
export function ToneIcon({ tone, className }: { tone: ScanTone; className?: string }) {
  const glyph = 'flex size-full items-center justify-center text-2xl font-bold leading-none';
  return (
    <span
      aria-hidden
      className={cn('flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-current', className)}
    >
      {tone === 'success' && <CheckLineIcon className="size-7" />}
      {tone === 'danger' && <AddLineIcon className="size-7 rotate-45" />}
      {tone === 'warning' && <span className={glyph}>!</span>}
      {tone === 'info' && <span className={glyph}>i</span>}
    </span>
  );
}

/** Full-width outcome of the last scan. The wrapper is a polite live region so screen readers hear each result. */
export function ScanResultPanel({ view }: { view: ScanView | null }) {
  return (
    <div role="status" aria-live="polite" className="w-full">
      {view ? (
        <div className={cn('flex w-full items-center gap-4 rounded-lg p-5', TONE[view.tone])}>
          <ToneIcon tone={view.tone} />
          <div className="min-w-0">
            <p className="text-2xl font-bold leading-tight">{view.title}</p>
            <p className="mt-1 break-words text-base">{view.detail}</p>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center gap-4 rounded-lg border border-border bg-card p-5 text-muted-foreground">
          <ScanLineIcon className="size-12 shrink-0" aria-hidden />
          <p className="text-lg font-medium">Ready to scan</p>
        </div>
      )}
    </div>
  );
}

export const TONE_CLASSES = TONE;
