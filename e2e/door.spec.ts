import { expect, test } from '@playwright/test';
import { apiAs, buyTickets, createFreshEvent, loginAs } from './helpers';

test('door staff admit a ticket once and reject repeats and garbage', async ({ page }) => {
  const organizer = await apiAs('organizer');
  const fresh = await createFreshEvent(organizer, { label: 'Door Night' });
  const buyer = await apiAs('buyer');
  const order = await buyTickets(buyer, fresh.eventId, 1);
  const code = order.tickets[0]?.code;
  if (!code) throw new Error('order has no ticket code');

  await loginAs(page, 'door');
  await page.goto(`/door/${fresh.eventId}`);
  const field = page.getByLabel('Ticket code');
  const result = page.getByRole('status').filter({ hasText: /Admitted|Already scanned|Not a valid ticket|Wrong event|Ready to scan/ });

  await field.fill(code);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result).toContainText('Admitted');

  await field.fill(code);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result).toContainText('Already scanned');

  await field.fill('STD1.garbage');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result).toContainText('Not a valid ticket');
  await organizer.dispose();
  await buyer.dispose();
});
