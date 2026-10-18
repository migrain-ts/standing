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

  // A valid ticket of another event of the same tenant is refused at this door.
  const other = await createFreshEvent(organizer, { label: 'Other Night' });
  const otherCode = (await buyTickets(buyer, other.eventId, 1)).tickets[0]?.code;
  if (!otherCode) throw new Error('second order has no ticket code');
  await field.fill(otherCode);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result).toContainText('Wrong event');
  await organizer.dispose();
  await buyer.dispose();
});
