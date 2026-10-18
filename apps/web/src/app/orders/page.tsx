'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AuthGate } from '@/components/AuthGate';
import { QueryError } from '@/components/QueryError';
import { SiteHeader } from '@/components/SiteHeader';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { OrderRow } from '@/lib/storefront';
import { joinPath } from '@/lib/paths';

function Orders() {
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api<{ orders: OrderRow[] }>('/me/orders') });
  const orders = q.data?.orders ?? [];
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:py-12">
      <H1 className="mb-6 text-2xl md:text-3xl">Your orders</H1>
      {q.isError && <QueryError title="Could not load your orders" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.isSuccess && orders.length === 0 && (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">You have not bought any tickets yet.</p>
          <Link href="/" className={buttonVariants()}>
            Browse events
          </Link>
        </Card>
      )}
      {orders.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Ordered</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.eventName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(o.totalCents)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={joinPath('orders', o.id)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                      View<span className="sr-only"> order for {o.eventName}</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}

export default function OrdersPage() {
  return (
    <>
      <SiteHeader />
      <AuthGate>
        <Orders />
      </AuthGate>
    </>
  );
}
