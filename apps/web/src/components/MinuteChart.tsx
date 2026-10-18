'use client';
import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { MinuteBucket } from '@/lib/live';

const config = { tickets: { label: 'Tickets', color: 'var(--chart-1)' } } satisfies ChartConfig;
const hhmm = new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

/** Tickets sold per minute (UTC), one series in one chart token. */
export function MinuteChart({ byMinute }: { byMinute: readonly MinuteBucket[] }) {
  const data = useMemo(() => byMinute.map((m) => ({ time: hhmm.format(new Date(m.bucket)), tickets: m.tickets })), [byMinute]);
  const total = data.reduce((n, d) => n + d.tickets, 0);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-56 w-full"
      role="img"
      aria-label={`Tickets sold per minute over the last ${data.length} minutes, ${total} in total`}
    >
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="tickets" type="monotone" stroke="var(--color-tickets)" strokeWidth={2} fill="var(--color-tickets)" fillOpacity={0.2} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}
