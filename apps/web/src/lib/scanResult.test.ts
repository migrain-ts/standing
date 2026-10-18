import { describe, expect, it } from 'vitest';
import { ApiClientError } from './api';
import { describeScan, type ScanResult } from './scanResult';

const ticket = { id: 't1', eventId: 'e1', eventName: 'Late Night Laughs', sectionName: 'Floor', rowLabel: 'C', number: 12 };

describe('describeScan', () => {
  it('admitted is success with section, row, seat', () => {
    const res: ScanResult = { result: 'admitted', ticket, scannedAt: '2026-10-18T20:00:00.000Z' };
    expect(describeScan(res)).toEqual({ tone: 'success', title: 'Admitted', detail: 'Floor, row C, seat 12' });
  });

  it('already_scanned is a warning with the first scan time in the local zone', () => {
    const iso = '2026-10-18T20:05:09.000Z';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const out = describeScan({ result: 'already_scanned', ticket, firstScannedAt: iso });
    expect(out).toEqual({ tone: 'warning', title: 'Already scanned', detail: `First scanned at ${local}` });
  });

  it('wrong_event is info and names the ticket event', () => {
    expect(describeScan({ result: 'wrong_event', ticket })).toEqual({
      tone: 'info',
      title: 'Wrong event',
      detail: 'Late Night Laughs',
    });
  });

  it('400 invalid_code is danger', () => {
    expect(describeScan(new ApiClientError(400, 'invalid_code', 'x'))).toEqual({
      tone: 'danger',
      title: 'Not a valid ticket',
      detail: 'This code is not a ticket issued by Standing.',
    });
  });

  it('404 is danger Unknown ticket', () => {
    const out = describeScan(new ApiClientError(404, 'not_found', 'Not found'));
    expect(out.tone).toBe('danger');
    expect(out.title).toBe('Unknown ticket');
  });

  it('anything else falls into the generic message', () => {
    for (const status of [500, 502, 429, 0]) {
      const out = describeScan(new ApiClientError(status, 'http_error', 'boom'));
      expect(out).toMatchObject({ tone: 'danger', title: 'Could not check this ticket, try again' });
    }
  });

  it('a 400 with another code is not called invalid ticket', () => {
    expect(describeScan(new ApiClientError(400, 'validation_error', 'x')).title).toBe('Could not check this ticket, try again');
  });
});
