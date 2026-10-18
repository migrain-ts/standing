const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const dateTime = new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' });
const day = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Money is integer cents everywhere; formatting happens only here. */
export const formatMoney = (cents: number): string => money.format(cents / 100);
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDay = (iso: string): string => day.format(new Date(iso));

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
