'use client';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format';
import type { TicketDto } from '@/lib/storefront';

/** One ticket: seat details and a QR code generated in the browser from the signed `code`. */
export function TicketCard({ ticket, eventName }: { ticket: TicketDto; eventName: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // Scanners need dark-on-light with a quiet zone, so these two colours are fixed on purpose.
    QRCode.toDataURL(ticket.code, { margin: 1, width: 176, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [ticket.code]);
  const seat = `${ticket.sectionName}, row ${ticket.rowLabel}, seat ${ticket.number}`;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      {src ? (
        <img src={src} width={176} height={176} alt={`QR code for ${seat}`} className="size-44 shrink-0 rounded-md bg-white" />
      ) : (
        <Skeleton className="size-44 shrink-0" />
      )}
      <dl className="grid flex-1 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Event</dt>
          <dd className="text-base font-semibold">{eventName}</dd>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-muted-foreground">Section</dt>
            <dd className="font-medium">{ticket.sectionName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Row</dt>
            <dd className="font-medium">{ticket.rowLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Seat</dt>
            <dd className="font-medium">{ticket.number}</dd>
          </div>
        </div>
        <div>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-medium tabular-nums">{formatMoney(ticket.priceCents)}</dd>
        </div>
      </dl>
    </Card>
  );
}
