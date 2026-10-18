import type { KeyboardEvent } from 'react';

const TABBABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a modal popup. The installed Sheet and AlertDialog (Base UI) let focus
 * escape to the page behind after the last control, so the popups pass this as `onKeyDown`.
 */
export function trapTab(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last || !(active instanceof HTMLElement) || !items.includes(active)) return;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
