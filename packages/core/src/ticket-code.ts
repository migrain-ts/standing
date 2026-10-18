import { createHmac, timingSafeEqual } from 'node:crypto';
import { asId, type TicketId } from '@standing/shared';

const PREFIX = 'STD1';
const HEX32 = /^[0-9a-f]{32}$/;
const SIG = /^[A-Za-z0-9_-]{22}$/;

const mac = (secret: string, id: string) =>
  createHmac('sha256', secret).update(`ticket:${id}`).digest().subarray(0, 16);

const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

/** `STD1.<32 hex of the ticket uuid>.<22 chars base64url of the first 16 HMAC bytes>` */
export function signTicket(secret: string, id: TicketId): string {
  return `${PREFIX}.${id.replaceAll('-', '')}.${mac(secret, id).toString('base64url')}`;
}

export function verifyTicket(secret: string, code: string): TicketId | null {
  const parts = code.split('.');
  const [prefix, hex, sig] = parts;
  if (parts.length !== 3 || prefix !== PREFIX || hex === undefined || sig === undefined) return null;
  if (!HEX32.test(hex) || !SIG.test(sig)) return null;
  const id = dashed(hex);
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(secret, id);
  // Canonical encoding only: the last base64url char carries padding bits that Buffer ignores.
  if (given.toString('base64url') !== sig) return null;
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return asId<'TicketId'>(id);
}
