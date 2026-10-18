import { defineConfig } from '@playwright/test';

// Runs against an already running stack (`docker compose -p standing up --build -d --wait`).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3200', trace: 'retain-on-failure' },
});
