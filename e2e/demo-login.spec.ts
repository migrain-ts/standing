import { expect, test } from '@playwright/test';

// Regression for the first demo login: a logged-out visitor who opened the home page first had a cached anonymous
// session, and the first demo click did not land on its page. Real UI clicks only, no API shortcut.

test('Organizer demo button from the logged-out home page lands on the tenant overview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Organizer', exact: true }).click();
  await expect(page).toHaveURL(/\/org\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
});

test('Buyer demo button from the logged-out home page lands on the home page signed in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Buyer', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Account menu for Ben Buyer' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});
