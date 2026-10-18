import { ApiClientError } from './api';

export type ScanTicket = {
  id: string;
  eventId: string;
  eventName: string;
  sectionName: string;
  rowLabel: string;
  number: number;
};

/** Body of POST /door/scan (200). */
export type ScanResult =
  | { result: 'admitted'; ticket: ScanTicket; scannedAt: string }
  | { result: 'already_scanned'; ticket: ScanTicket; firstScannedAt: string }
  | { result: 'wrong_event'; ticket: ScanTicket };

export type ScanTone = 'success' | 'warning' | 'danger' | 'info';
export type ScanView = { tone: ScanTone; title: string; detail: string };

const pad = (n: number): string => String(n).padStart(2, '0');
/** HH:MM:SS in the browser's time zone. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled scan result: ${JSON.stringify(x)}`);
}

export function describeScan(res: ScanResult | ApiClientError): ScanView {
  if (res instanceof ApiClientError) {
    if (res.status === 400 && res.code === 'invalid_code') {
      return { tone: 'danger', title: 'Not a valid ticket', detail: 'This code is not a ticket issued by Standing.' };
    }
    if (res.status === 404) {
      return { tone: 'danger', title: 'Unknown ticket', detail: 'This ticket does not belong to your organizations.' };
    }
    return { tone: 'danger', title: 'Could not check this ticket, try again', detail: 'Nothing was recorded for this scan.' };
  }
  switch (res.result) {
    case 'admitted':
      return {
        tone: 'success',
        title: 'Admitted',
        detail: `${res.ticket.sectionName}, row ${res.ticket.rowLabel}, seat ${res.ticket.number}`,
      };
    case 'already_scanned':
      return { tone: 'warning', title: 'Already scanned', detail: `First scanned at ${formatClock(res.firstScannedAt)}` };
    case 'wrong_event':
      return { tone: 'info', title: 'Wrong event', detail: res.ticket.eventName };
    default:
      return assertNever(res);
  }
}
