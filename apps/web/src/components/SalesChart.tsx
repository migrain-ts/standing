'use client';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatMoney } from '@/lib/format';
import type { OverviewDay } from '@/lib/organizer';

const config = { revenueCents: { label: 'Revenue', color: 'var(--chart-1)' } } satisfies ChartConfig;
const dayLabel = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const axisMoney = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 });
const shortDay = (iso: string): string => dayLabel.format(new Date(`${iso}T00:00:00Z`));

/** Revenue per day, one series in one chart token. */
export function SalesChart({ days }: { days: OverviewDay[] }) {
  const total = days.reduce((n, d) => n + d.revenueCents, 0);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      role="img"
      aria-label={`Revenue per day over the last ${days.length} days, ${formatMoney(total)} in total`}
    >
      <BarChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={shortDay} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => axisMoney.format(v / 100)} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_: unknown, payload: readonly { payload?: OverviewDay }[]) => {
                const d = payload[0]?.payload?.day;
                return d ? shortDay(d) : '';
              }}
              formatter={(value: unknown) => (typeof value === 'number' ? formatMoney(value) : String(value))}
            />
          }
        />
        <Bar dataKey="revenueCents" fill="var(--color-revenueCents)" radius={2} />
      </BarChart>
    </ChartContainer>
  );
}
