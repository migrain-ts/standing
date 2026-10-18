export type NavItem = { label: string; href: string };
export type NavMe = { tenants: number; door: boolean };

/** `null` is an anonymous visitor. `tenants` counts organizer-level (owner or manager) memberships. */
export function navItems(me: NavMe | null): NavItem[] {
  const items: NavItem[] = [{ label: 'Events', href: '/' }];
  if (!me) return items;
  items.push({ label: 'My orders', href: '/orders' });
  if (me.tenants > 0) items.push({ label: 'Organizer', href: '/org' });
  if (me.door) items.push({ label: 'Door', href: '/door' });
  return items;
}

const BASE = 'http://localhost';
// Any whitespace or control character: browsers strip tab/newline when parsing URLs ("/\t/x" -> "//x").
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/** Only same-origin paths survive; anything else falls back (open-redirect guard for `?next=`). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || UNSAFE_CHARS.test(next)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  const rest = url.pathname + url.search + url.hash;
  if (url.origin !== BASE || !rest.startsWith('/') || rest.startsWith('//')) return fallback;
  return next;
}
