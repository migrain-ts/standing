import { expect, test } from '@playwright/test';
import { apiAs, createFreshEvent, loginAs } from './helpers';

test('organizer runs a Rush on a fresh event: nothing is oversold', async ({ page }) => {
  const organizer = await apiAs('organizer');
  const fresh = await createFreshEvent(organizer);

  await loginAs(page, 'organizer');
  await page.goto(`/org/${fresh.tenantId}/events/${fresh.eventId}`);
  await expect(page.getByRole('heading', { level: 1, name: fresh.name })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const sold = page.getByTestId('sold');
  const soldNow = async () => Number(((await sold.textContent()) ?? '').split('/')[0]?.replace(/[^\d]/g, '') ?? 'NaN');
  const before = await soldNow();
  expect(before).toBe(0);

  // Sliders are keyboard driven: Home goes to the minimum, then arrows step.
  const buyers = page.getByRole('slider', { name: 'Buyers' });
  const duration = page.getByRole('slider', { name: 'Duration' });
  await buyers.focus();
  await buyers.press('Home');
  const min = Number(await buyers.getAttribute('aria-valuenow'));
  const step = 50;
  for (let v = min; v < 300; v += step) await buyers.press('ArrowRight');
  await duration.focus();
  await duration.press('Home');
  for (let v = Number(await duration.getAttribute('aria-valuenow')); v < 10; v += 1) await duration.press('ArrowRight');

  await page.getByRole('button', { name: 'Start Rush' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByText('Run finished')).toBeVisible({ timeout: 90_000 });

  await expect(page.getByLabel('Oversold')).toHaveText('0');
  expect(await soldNow()).toBeGreaterThan(before);

  const csv = await organizer.get(`/api/tenants/${fresh.tenantId}/exports/sales.csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect((await csv.text()).split('\n').length).toBeGreaterThan(100);
  await organizer.dispose();
});
