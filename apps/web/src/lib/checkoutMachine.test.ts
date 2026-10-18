import { describe, expect, it } from 'vitest';
import { checkoutReducer, initialCheckout, type CheckoutState, type HoldInfo } from './checkoutMachine';

const hold: HoldInfo = { id: 'h1', expiresAt: '2026-10-18T12:10:00Z', totalCents: 9000, seatIdxs: [1, 2] };
const run = (s: CheckoutState, ...a: Parameters<typeof checkoutReducer>[1][]) => a.reduce(checkoutReducer, s);

describe('checkoutReducer', () => {
  it('starts idle and moves to queued on start', () => {
    expect(initialCheckout.phase).toBe('idle');
    expect(run(initialCheckout, { type: 'start' }).phase).toBe('queued');
  });
  it('updates the position while queued, then admits into selecting', () => {
    const q = run(initialCheckout, { type: 'start' }, { type: 'queue', position: 4, queueLength: 20 });
    expect(q).toMatchObject({ phase: 'queued', position: 4, queueLength: 20 });
    expect(run(q, { type: 'admit', ticket: 't1' })).toEqual({ phase: 'selecting', ticket: 't1' });
  });
  it('ignores actions that do not fit the phase', () => {
    expect(run(initialCheckout, { type: 'reserve' })).toBe(initialCheckout);
    expect(run(initialCheckout, { type: 'paid', orderId: 'o' })).toBe(initialCheckout);
  });
  it('selecting -> holding -> paying', () => {
    const s = run(initialCheckout, { type: 'start' }, { type: 'admit', ticket: null }, { type: 'reserve' });
    expect(s.phase).toBe('holding');
    const p = run(s, { type: 'held', hold, key: 'k1' });
    expect(p).toMatchObject({ phase: 'paying', hold, key: 'k1', submitting: false });
  });
  it('a failed reserve returns to selecting', () => {
    const s = run(initialCheckout, { type: 'start' }, { type: 'admit', ticket: 't' }, { type: 'reserve' }, { type: 'reserveFailed' });
    expect(s).toEqual({ phase: 'selecting', ticket: 't' });
  });
  it('paying -> paid', () => {
    const p = payingState();
    expect(run(p, { type: 'submit' }, { type: 'paid', orderId: 'o1' })).toEqual({ phase: 'paid', orderId: 'o1' });
  });
  it('a decline followed by a retry gets a new key and is no longer submitting', () => {
    const p = payingState();
    const d = run(p, { type: 'submit' }, { type: 'declined' });
    expect(d.phase).toBe('declined');
    const r = run(d, { type: 'retry', key: 'k2' });
    expect(r).toMatchObject({ phase: 'paying', key: 'k2', submitting: false, hold });
  });
  it('expiry while paying moves to expired, but not while a payment is in flight', () => {
    const p = payingState();
    expect(run(p, { type: 'expire' })).toEqual({ phase: 'expired', ticket: 't' });
    expect(run(p, { type: 'submit' }, { type: 'expire' }).phase).toBe('paying');
  });
  it('expiry after a decline moves to expired; restart returns to selecting', () => {
    const d = run(payingState(), { type: 'submit' }, { type: 'declined' }, { type: 'expire' });
    expect(d.phase).toBe('expired');
    expect(run(d, { type: 'restart' })).toEqual({ phase: 'selecting', ticket: 't' });
  });
  it('cancel from paying or declined returns to selecting', () => {
    expect(run(payingState(), { type: 'cancel' })).toEqual({ phase: 'selecting', ticket: 't' });
    expect(run(payingState(), { type: 'submit' }, { type: 'declined' }, { type: 'cancel' })).toEqual({ phase: 'selecting', ticket: 't' });
  });
});

describe('checkoutReducer recovery', () => {
  it('submitFailed clears the in-flight flag', () => {
    const s = run(payingState(), { type: 'submit' }, { type: 'submitFailed' });
    expect(s).toMatchObject({ phase: 'paying', submitting: false });
  });
  it('requeue sends a selecting buyer back to the queue', () => {
    expect(run(initialCheckout, { type: 'start' }, { type: 'admit', ticket: 't' }, { type: 'requeue' })).toEqual({ phase: 'queued' });
  });
});

function payingState(): CheckoutState {
  return run(initialCheckout, { type: 'start' }, { type: 'admit', ticket: 't' }, { type: 'reserve' }, { type: 'held', hold, key: 'k1' });
}
