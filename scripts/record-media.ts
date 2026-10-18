// Records the README screenshots and the organizer Rush clip against the running compose stack.
// Usage: npm run media   (needs the stack up and ffmpeg on the PATH for the GIF)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { apiAs, BASE_URL, buyTickets, createFreshEvent, loginAs } from '../e2e/helpers';

const media = path.resolve(import.meta.dirname, '../docs/media');
const tmp = path.join(media, 'tmp');
mkdirSync(tmp, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(media, name) });
const viewport = { width: 1280, height: 800 };

async function setSlider(page: Page, name: string, target: number) {
  const slider = page.getByRole('slider', { name });
  await slider.focus();
  await slider.press('Home');
  for (let v = Number(await slider.getAttribute('aria-valuenow')); v < target; ) {
    await slider.press('ArrowRight');
    const next = Number(await slider.getAttribute('aria-valuenow'));
    if (next === v) break;
    v = next;
  }
}

const organizer = await apiAs('organizer');
const buyer = await apiAs('buyer');
const browser = await chromium.launch();

// Still pictures.
{
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('button', { name: 'Door staff' }).waitFor();
  await shot(page, '01-login.png');

  await loginAs(page, 'buyer');
  await page.goto(`${BASE_URL}/`);
  await page.getByRole('link', { name: /Velvet Sessions/ }).first().waitFor();
  await shot(page, '02-storefront.png');
  await page.getByRole('link', { name: /Velvet Sessions/ }).first().click();
  await page.getByLabel('Seats', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Best available' }).click();
  await page.getByText('Your seats').waitFor();
  await page.waitForTimeout(800);
  await shot(page, '03-seatmap.png');

  await loginAs(page, 'organizer');
  await page.goto(`${BASE_URL}/org`);
  await page.waitForURL(/\/org\/[0-9a-f-]{36}/);
  await page.waitForTimeout(1500);
  await shot(page, '04-org-overview.png');

  // Door: a fresh ticket so the screenshot shows an admitted scan.
  const doorEvent = await createFreshEvent(organizer, { label: 'Door Night' });
  const order = await buyTickets(buyer, doorEvent.eventId, 1);
  await loginAs(page, 'door');
  await page.goto(`${BASE_URL}/door/${doorEvent.eventId}`);
  await page.getByLabel('Ticket code').fill(order.tickets[0]?.code ?? '');
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('status').getByText('Admitted').waitFor();
  await page.waitForTimeout(500);
  await shot(page, '08-door.png');
  await ctx.close();
}

// The Rush, on a fresh event with a few earlier sales so the dashboard is not empty.
{
  const fresh = await createFreshEvent(organizer, { label: 'Rush Night' });
  for (let i = 0; i < 12; i++) await buyTickets(buyer, fresh.eventId, 4, i * 40);
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport, recordVideo: { dir: tmp, size: viewport } });
  const page = await ctx.newPage();
  await loginAs(page, 'organizer');
  await page.goto(`${BASE_URL}/org/${fresh.tenantId}/events/${fresh.eventId}`);
  await page.getByText('Live', { exact: true }).waitFor();
  await page.waitForTimeout(1500);
  await setSlider(page, 'Buyers', 500);
  await setSlider(page, 'Duration', 12);
  await shot(page, '05-live-before.png');
  await page.getByRole('button', { name: 'Start Rush' }).click();
  await page.waitForTimeout(6000);
  await shot(page, '06-live-rush.png');
  await page.getByText('Run finished').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await shot(page, '07-live-after.png');
  const video = page.video();
  await ctx.close();
  await video?.saveAs(path.join(tmp, 'rush.webm'));
}
await browser.close();
await organizer.dispose();
await buyer.dispose();

// GIF: fps 10, 800 px wide, generated palette, at most 20 s, at most 8 MB.
const webm = path.join(tmp, 'rush.webm');
const gif = path.join(media, 'rush.gif');
for (const [fps, width] of [[10, 800], [8, 720], [6, 640], [5, 560]] as const) {
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3', '-t', '20', '-i', webm, '-vf', `${filter},split[a][b];[a]palettegen[p];[b][p]paletteuse`, gif]);
  const mb = statSync(gif).size / 1024 ** 2;
  console.log(`gif ${fps} fps ${width}px: ${mb.toFixed(1)} MB`);
  if (mb <= 8) process.exit(0);
}
rmSync(gif, { force: true });
throw new Error('GIF does not fit in 8 MB');
