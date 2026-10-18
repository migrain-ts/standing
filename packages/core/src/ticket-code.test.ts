import { describe, expect, it } from 'vitest';
import { asId, type TicketId } from '@standing/shared';
import { signTicket, verifyTicket } from './ticket-code';

const id = asId<'TicketId'>('3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80') as TicketId;

describe('ticket codes', () => {
  it('round-trips and is stable', () => {
    const code = signTicket('s3cret', id);
    expect(code).toMatch(/^STD1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{22}$/);
    expect(verifyTicket('s3cret', code)).toBe(id);
    expect(signTicket('s3cret', id)).toBe(code);
  });
  it('rejects a wrong secret, an edited id, an edited signature and malformed input', () => {
    const code = signTicket('s3cret', id);
    expect(verifyTicket('other', code)).toBeNull();
    expect(verifyTicket('s3cret', code.replace('3f2b', '3f2c'))).toBeNull();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const c of alphabet) {
      if (c === code.slice(-1)) continue;
      expect(verifyTicket('s3cret', code.slice(0, -1) + c), c).toBeNull();
    }
    for (const bad of ['', 'STD1', 'STD1.x.y', 'STD2.' + code.slice(5), code + 'x', code.slice(0, 20), '\u0000']) {
      expect(verifyTicket('s3cret', bad), bad).toBeNull();
    }
  });
});
