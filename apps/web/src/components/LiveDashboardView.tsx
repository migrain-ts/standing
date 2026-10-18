import { ExportsPanel, type ReportControl } from '@/components/ExportsPanel';
import { LiveSeatMap } from '@/components/LiveSeatMap';
import { MinuteChart } from '@/components/MinuteChart';
import { OversoldBadge } from '@/components/OversoldBadge';
import { PageHeader } from '@/components/OrgBits';
import { RushPanel, type RushControl } from '@/components/RushPanel';
import { SectionBars } from '@/components/SectionBars';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { LiveState } from '@/lib/live';
import type { LiveStatus } from '@/lib/useLive';
import { fillPercent } from '@/lib/organizer';
import type { VenueMap } from '@/lib/seatmap';

export type LiveDashboardProps = {
  state: LiveState;
  map: VenueMap | null;
  status: LiveStatus;
  rush: RushControl;
  csvHref: string;
  xlsxHref: string;
  report: ReportControl;
};

const nf = new Intl.NumberFormat('en-IE');

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  const live = status === 'live';
  return (
    <Badge variant={live ? 'success-light' : 'warning-light'} size="lg" className="whitespace-nowrap" role="status">
      <span aria-hidden className={live ? 'size-2 rounded-full bg-current motion-safe:animate-pulse' : 'size-2 rounded-full border-2 border-current'} />
      {live ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
    </Badge>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Purely presentational: everything arrives as props, so the real page and a fixture render the same screen. */
export function LiveDashboardView({ state, map, status, rush, csvHref, xlsxHref, report }: LiveDashboardProps) {
  const { snapshot } = state;
  const t = snapshot.totals;
  const pct = fillPercent(t.sold, snapshot.capacity);
  return (
    <div className="space-y-8">
      <PageHeader
        title={snapshot.event.name}
        description={`Live sales, starts ${formatDateTime(snapshot.event.startsAt)}`}
        action={<LiveIndicator status={status} />}
      />

      <section aria-label="Key figures" className="flex flex-wrap items-end gap-x-12 gap-y-6">
        <div className="min-w-64 flex-1 basis-72">
          <p className="text-sm text-muted-foreground">Sold</p>
          <p data-testid="sold" className="text-5xl font-semibold tabular-nums tracking-tight md:text-6xl">
            {nf.format(t.sold)}
            <span className="text-2xl font-normal text-muted-foreground"> / {nf.format(snapshot.capacity)}</span>
          </p>
          <Progress value={pct} aria-label={`${pct}% of seats sold`} className="mt-3 h-2" />
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Figure label="Revenue" value={formatMoney(t.revenueCents)} />
          <Figure label="Held" value={nf.format(t.held)} />
          <Figure label="Queue waiting" value={t.queue ? nf.format(t.queue.waiting) : 'n/a'} />
          <Figure label="Queue active" value={t.queue ? nf.format(t.queue.active) : 'n/a'} />
          <Figure label="Scanned" value={nf.format(t.scanned)} />
        </dl>
      </section>

      <OversoldBadge oversold={t.oversold} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Seats">
            {map ? <LiveSeatMap map={map} state={state} /> : <Skeleton className="h-80 w-full" />}
          </Panel>
          <Panel title="Sales per minute">
            <MinuteChart byMinute={snapshot.byMinute} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Rush">
            <RushPanel control={rush} />
          </Panel>
          <Panel title="Sections">
            <SectionBars sections={snapshot.sections} />
          </Panel>
          <Panel title="Exports">
            <ExportsPanel csvHref={csvHref} xlsxHref={xlsxHref} report={report} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
