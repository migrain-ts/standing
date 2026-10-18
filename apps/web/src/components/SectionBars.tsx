import { Progress } from '@/components/ui/progress';
import { fillPercent } from '@/lib/organizer';
import { sectionToken } from '@/lib/seatmap';
import type { SectionFigure } from '@/lib/live';

/** Sold share per section; the swatch is the colour the section has on the seat map. */
export function SectionBars({ sections }: { sections: readonly SectionFigure[] }) {
  return (
    <ul className="space-y-4">
      {sections.map((s, i) => (
        <li key={s.id}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <span aria-hidden className="size-3 rounded-full" style={{ background: `var(${sectionToken(i)})` }} />
              {s.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {s.sold} / {s.capacity}
            </span>
          </div>
          <Progress value={fillPercent(s.sold, s.capacity)} aria-label={`${s.name} sold`} className="h-2" />
        </li>
      ))}
    </ul>
  );
}
