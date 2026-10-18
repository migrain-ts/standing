export const MAX_EUROS = 10_000;

/** Price in euros per section; blank means no price yet. Returns cents or an error message. */
export function parsePrice(s: string): { ok: true; cents: number } | { ok: false; error: string } {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'Enter an amount like 45 or 45.50' };
  const euros = Number(t);
  if (euros > MAX_EUROS) return { ok: false, error: `At most ${MAX_EUROS.toLocaleString('en-IE')} euros` };
  return { ok: true, cents: Math.round(euros * 100) };
}

