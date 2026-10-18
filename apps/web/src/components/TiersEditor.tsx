'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Tier } from '@/lib/organizer';

const MAX_EUROS = 10_000;

/** Price in euros per section; blank means no price yet. Returns cents or an error message. */
export function parsePrice(s: string): { ok: true; cents: number } | { ok: false; error: string } {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'Enter an amount like 45 or 45.50' };
  const euros = Number(t);
  if (euros > MAX_EUROS) return { ok: false, error: `At most ${MAX_EUROS.toLocaleString('en-IE')} euros` };
  return { ok: true, cents: Math.round(euros * 100) };
}

export function TiersEditor({ sections, tiers, pending, onSave }: { sections: { id: string; name: string }[]; tiers: Tier[]; pending: boolean; onSave: (t: Tier[]) => void }) {
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(tiers.map((t) => [t.sectionId, (t.priceCents / 100).toFixed(2)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const next: Record<string, string> = {};
        const out: Tier[] = [];
        for (const s of sections) {
          const raw = prices[s.id] ?? '';
          if (raw.trim() === '') continue;
          const p = parsePrice(raw);
          if (p.ok) out.push({ sectionId: s.id, priceCents: p.cents });
          else next[s.id] = p.error;
        }
        if (out.length === 0 && Object.keys(next).length === 0) next[sections[0]?.id ?? ''] = 'Set at least one price';
        setErrors(next);
        if (Object.keys(next).length === 0) onSave(out);
      }}
    >
      {sections.map((s) => (
        <div key={s.id} className="grid grid-cols-[1fr_8rem] items-start gap-3">
          <Label htmlFor={`price-${s.id}`} className="pt-3 md:pt-2.5">
            {s.name} (EUR)
          </Label>
          <div>
            <Input id={`price-${s.id}`} inputMode="decimal" value={prices[s.id] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [s.id]: e.target.value }))} aria-invalid={!!errors[s.id]} className="h-11 text-right md:h-9" />
            {errors[s.id] && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {errors[s.id]}
              </p>
            )}
          </div>
        </div>
      ))}
      <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={pending}>
        Save prices
      </Button>
    </form>
  );
}
