import { expect, test } from '@playwright/test';
import { apiAs, createFreshEvent, loginAs, setSlider } from './helpers';

test('organizer runs a Rush on a fresh event: nothing is oversold', async ({ page }) => {
  const organizer = await apiAs('organizer');
  const fresh = await createFreshEvent(organizer);

  await loginAs(page, 'organizer');
  await page.goto(`/org/${fresh.tenantId}/events/${fresh.eventId}`);
  await expect(page.getByRole('heading', { level: 1, name: fresh.name })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const sold = page.getByTestId('sold');
  const soldNow = async () => Number(((await sold.textContent()) ?? '').split('/')[0]?.replace(/[^\d]/g, '') ?? 'NaN');
  await expect.poll(soldNow).toBe(0);

  // Sliders are keyboard driven: 500 buyers arriving over 10 seconds.
  await setSlider(page, 'Buyers', 500);
  await setSlider(page, 'Duration', 10);

  await page.getByRole('button', { name: 'Start Rush' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByText('Run finished')).toBeVisible({ timeout: 90_000 });

  await expect(page.getByLabel('Oversold')).toHaveText('0');
  await expect.poll(soldNow, { timeout: 15_000 }).toBeGreaterThan(0);

  // The export filtered on this event holds this run's sales and no row of any other event.
  const csv = await organizer.get(`/api/tenants/${fresh.tenantId}/exports/sales.csv?eventId=${fresh.eventId}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const rows = (await csv.text()).split('\r\n').slice(1).filter((line) => line.length > 0);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row).toContain(`,${fresh.name},`);
  await organizer.dispose();
});
