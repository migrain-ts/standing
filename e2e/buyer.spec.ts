import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

test('buyer reserves two seats, pays and downloads the ticket PDF', async ({ page }) => {
  await loginAs(page, 'buyer');
  await page.goto('/');
  await page.getByRole('link', { name: /Velvet Sessions/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Velvet Sessions' })).toBeVisible();

  await page.getByLabel('Seats', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Best available' }).click();
  await page.getByRole('button', { name: 'Reserve' }).click();

  await expect(page.getByRole('timer', { name: 'Time left to pay' })).toBeVisible();

  // The simulated gateway declines about 5% of attempts; the seats stay held, so pressing again is the real user path.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByRole('button', { name: /^(Pay|Try again)/ }).click();
    const outcome = page.getByRole('link', { name: 'View your tickets' }).or(page.getByText('The payment was declined'));
    await expect(outcome).toBeVisible();
    if (await page.getByRole('link', { name: 'View your tickets' }).isVisible()) break;
  }
  await page.getByRole('link', { name: 'View your tickets' }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByAltText(/^QR code for /)).toHaveCount(2);
  await expect(page.getByAltText(/^QR code for /).first()).toBeVisible();

  const download = page.getByRole('button', { name: 'Download tickets (PDF)' });
  await expect(download).toBeEnabled({ timeout: 60_000 });

  const documentId = await page.evaluate(async () => {
    const orderId = location.pathname.split('/').pop();
    const res = await fetch(`/api/orders/${orderId}`);
    return ((await res.json()) as { order: { documentId: string } }).order.documentId;
  });
  const pdf = await page.request.get(`/api/documents/${documentId}/download`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
