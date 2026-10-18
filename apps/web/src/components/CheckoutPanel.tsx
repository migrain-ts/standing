'use client';
import Link from 'next/link';
import { useState } from 'react';
import { QueuePanel } from '@/components/QueuePanel';
import { CheckLineIcon } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import type { CheckoutState } from '@/lib/checkoutMachine';
import { formatCountdown, formatMoney } from '@/lib/format';
import { seatsLabel } from '@/lib/storefront';

export type PanelSeat = { idx: number; label: string; priceCents: number };

type Props = {
  state: CheckoutState;
  seats: PanelSeat[];
  heldSeats: PanelSeat[];
  maxSeats: number;
  sections: { ord: number; name: string; priceCents: number }[];
  sectionOrd: number | null;
  onSection: (ord: number | null) => void;
  bestNotice: string | null;
  bestCount: number;
  onBestCount: (n: number) => void;
  onBest: () => void;
  onClear: () => void;
  onReserve: () => void;
  onPay: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onRestart: () => void;
  remaining: number;
  notice: string | null;
};

const digits = (v: string) => v.replace(/\D/g, '');
const groupCard = (v: string) => digits(v).slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
const formatExpiry = (v: string) => {
  const d = digits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

function SeatList({ seats }: { seats: PanelSeat[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {seats.map((s) => (
        <li key={s.idx} className="flex items-baseline justify-between gap-3">
          <span>{s.label}</span>
          <span className="tabular-nums text-muted-foreground">{formatMoney(s.priceCents)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CheckoutPanel(p: Props) {
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('12/30');
  const [cvc, setCvc] = useState('123');
  const [checked, setChecked] = useState(false);
  const cardError = checked && digits(card).length < 13 ? 'Card number is incomplete' : null;
  const expiryError = checked && digits(expiry).length < 4 ? 'Enter the expiry as MM/YY' : null;
  const cvcError = checked && digits(cvc).length < 3 ? 'CVC has 3 or 4 digits' : null;
  const valid = digits(card).length >= 13 && digits(expiry).length === 4 && digits(cvc).length >= 3;
  const total = p.seats.reduce((n, s) => n + s.priceCents, 0);

  const { state } = p;
  switch (state.phase) {
    case 'paid':
      return (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckLineIcon className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Payment complete</h2>
              <p className="text-sm text-muted-foreground">Your tickets are ready.</p>
            </div>
            <Link href={`/orders/${state.orderId}`} className={buttonVariants({ className: 'h-11 w-full md:h-10' })}>
              View your tickets
            </Link>
          </CardContent>
        </Card>
      );
    case 'expired':
      return (
        <Card>
          <CardContent className="space-y-4 p-6">
            <Alert variant="destructive">
              <AlertTitle>Your reservation expired</AlertTitle>
              <AlertDescription>The seats went back on sale. Nothing was charged.</AlertDescription>
            </Alert>
            <Button className="h-11 w-full md:h-10" onClick={p.onRestart}>
              Choose seats again
            </Button>
          </CardContent>
        </Card>
      );
    case 'paying':
    case 'declined': {
      const declined = state.phase === 'declined';
      const submitting = state.phase === 'paying' && state.submitting;
      const heldTotal = state.hold.totalCents;
      return (
        <Card>
          <CardHeader className="space-y-2 pb-4">
            <h2 className="text-lg font-semibold">Pay to keep your seats</h2>
            <p className="text-sm text-muted-foreground" role="timer" aria-label="Time left to pay">
              Held for <span className="font-semibold tabular-nums text-foreground">{formatCountdown(p.remaining)}</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <SeatList seats={p.heldSeats} />
            <Separator />
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-3xl font-semibold tabular-nums">{formatMoney(heldTotal)}</span>
            </div>
            {declined && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>The payment was declined</AlertTitle>
                <AlertDescription>Nothing was charged. Your seats are still held.</AlertDescription>
              </Alert>
            )}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setChecked(true);
                if (!valid) return;
                if (declined) p.onRetry();
                else p.onPay();
              }}
              noValidate
            >
              <Badge variant="outline">Demo payment, no real card</Badge>
              <div className="space-y-2">
                <Label htmlFor="card-number">Card number</Label>
                <Input
                  id="card-number"
                  className="h-11 md:h-9"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  value={card}
                  onChange={(e) => setCard(groupCard(e.target.value))}
                  aria-invalid={cardError ? true : undefined}
                  aria-describedby={cardError ? 'card-number-error' : undefined}
                />
                {cardError && (
                  <p id="card-number-error" className="text-sm text-destructive">
                    {cardError}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="card-expiry">Expiry</Label>
                  <Input
                    id="card-expiry"
                    className="h-11 md:h-9"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    aria-invalid={expiryError ? true : undefined}
                    aria-describedby={expiryError ? 'card-expiry-error' : undefined}
                  />
                  {expiryError && (
                    <p id="card-expiry-error" className="text-sm text-destructive">
                      {expiryError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="card-cvc">CVC</Label>
                  <Input
                    id="card-cvc"
                    className="h-11 md:h-9"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    value={cvc}
                    onChange={(e) => setCvc(digits(e.target.value).slice(0, 4))}
                    aria-invalid={cvcError ? true : undefined}
                    aria-describedby={cvcError ? 'card-cvc-error' : undefined}
                  />
                  {cvcError && (
                    <p id="card-cvc-error" className="text-sm text-destructive">
                      {cvcError}
                    </p>
                  )}
                </div>
              </div>
              <Button type="submit" className="h-11 w-full md:h-10" disabled={submitting}>
                {submitting ? 'Processing payment' : declined ? 'Try again' : `Pay ${formatMoney(heldTotal)}`}
              </Button>
            </form>
            <Button variant="ghost" className="h-11 w-full md:h-9" onClick={p.onCancel} disabled={submitting}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      );
    }
    case 'idle':
    case 'queued':
    case 'selecting':
    case 'holding': {
      const busy = state.phase === 'holding';
      return (
        <Card>
          <CardHeader className="pb-4">
            <h2 className="text-lg font-semibold">Your seats</h2>
          </CardHeader>
          <CardContent className="space-y-5">
            <QueuePanel state={state} />
            {p.notice && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{p.notice}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-end gap-2">
              <div className="w-24 space-y-2">
                <Label htmlFor="best-count">Seats</Label>
                <NativeSelect id="best-count" className="h-11 md:h-9" value={p.bestCount} onChange={(e) => p.onBestCount(Number(e.target.value))}>
                  {Array.from({ length: p.maxSeats }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button variant="secondary" className="h-11 flex-1 md:h-9" onClick={p.onBest}>
                Best available
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="best-section">Section</Label>
              <NativeSelect
                id="best-section"
                className="h-11 md:h-9"
                value={p.sectionOrd ?? ''}
                onChange={(e) => p.onSection(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Any section</option>
                {p.sections.map((s) => (
                  <option key={s.ord} value={s.ord}>
                    {s.name} - {formatMoney(s.priceCents)}
                  </option>
                ))}
              </NativeSelect>
              {p.bestNotice && (
                <p role="status" className="text-sm text-muted-foreground">
                  {p.bestNotice}
                </p>
              )}
            </div>
            <Separator />
            {p.seats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Select up to {p.maxSeats} seats on the map, or use Best available.</p>
            ) : (
              <div className="space-y-3">
                <SeatList seats={p.seats} />
                <Button variant="link" size="sm" className="h-11 p-0 md:h-auto" onClick={p.onClear}>
                  Clear selection
                </Button>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">{seatsLabel(p.seats.length)}</span>
              <span className="text-3xl font-semibold tabular-nums">{formatMoney(total)}</span>
            </div>
            <Button className="h-11 w-full md:h-10" disabled={busy || p.seats.length === 0 || state.phase === 'queued'} onClick={p.onReserve}>
              {busy ? 'Reserving' : 'Reserve'}
            </Button>
          </CardContent>
        </Card>
      );
    }
    default: {
      const never: never = state;
      return never;
    }
  }
}
