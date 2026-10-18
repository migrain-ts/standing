'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AuthGate } from '@/components/AuthGate';
import { QueryError } from '@/components/QueryError';
import { SiteHeader } from '@/components/SiteHeader';
import { TicketCard } from '@/components/TicketCard';
import { DownloadLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { DocumentDto, OrderDto, OrderRow } from '@/lib/storefront';
import { seatsLabel } from '@/lib/storefront';

/** Polls the ticket PDF until it is ready, then enables the download. */
function PdfDownload({ documentId }: { documentId: string }) {
  const q = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => api<{ document: DocumentDto }>(`/documents/${documentId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.document.status;
      return status === 'ready' || status === 'failed' ? false : 1500;
    },
  });
  const status = q.data?.document.status;
  const ready = status === 'ready';
  return (
    <div className="space-y-3">
      <Button
        className="h-11 md:h-10"
        disabled={!ready}
        onClick={() => window.location.assign(`/api/documents/${documentId}/download`)}
      >
        <DownloadLineIcon className="size-4" aria-hidden />
        Download tickets (PDF)
      </Button>
      {!ready && status !== 'failed' && (
        <div className="flex items-center gap-3" role="status">
          <Skeleton className="h-4 w-24" />
          <span className="text-sm text-muted-foreground">Preparing your PDF</span>
        </div>
      )}
      {status === 'failed' && <p className="text-sm text-destructive">The PDF could not be prepared. Your tickets above are still valid.</p>}
      {q.isError && <p className="text-sm text-destructive">Could not check the PDF status.</p>}
    </div>
  );
}

function Order() {
  const { orderId } = useParams<{ orderId: string }>();
  const orderQ = useQuery({ queryKey: ['order', orderId], queryFn: () => api<{ order: OrderDto }>(`/orders/${orderId}`) });
  const rowsQ = useQuery({ queryKey: ['orders'], queryFn: () => api<{ orders: OrderRow[] }>('/me/orders') });
  const order = orderQ.data?.order;
  const row = rowsQ.data?.orders.find((o) => o.id === orderId);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
      <Link href="/orders" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Your orders
      </Link>
      {orderQ.isError && (
        <div className="mt-4">
          <QueryError title="Could not load this order" error={orderQ.error} onRetry={() => orderQ.refetch()} />
        </div>
      )}
      {orderQ.isPending && <Skeleton className="mt-4 h-48 w-full" />}
      {order && (
        <div className="mt-3 space-y-6">
          <header className="space-y-2">
            <H1 className="text-2xl md:text-3xl">{row?.eventName ?? 'Your tickets'}</H1>
            <p className="text-sm text-muted-foreground">
              {seatsLabel(order.tickets.length)}, {formatMoney(order.totalCents)}, ordered {formatDateTime(order.createdAt)}
            </p>
          </header>
          {order.documentId ? <PdfDownload documentId={order.documentId} /> : null}
          <ul className="space-y-4">
            {order.tickets.map((t) => (
              <li key={t.id}>
                <TicketCard ticket={t} eventName={row?.eventName ?? 'Your event'} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

export default function OrderPage() {
  return (
    <>
      <SiteHeader />
      <AuthGate>
        <Order />
      </AuthGate>
    </>
  );
}
