import { serve } from '@hono/node-server';
import { createDb } from '@standing/db';
import { numberFromEnv } from '@standing/shared';
import { createSimulatorServer } from './server';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const token = process.env.SIMULATOR_TOKEN;
if (!token) throw new Error('SIMULATOR_TOKEN is required');
const { db } = createDb(url);
const app = createSimulatorServer({ token, apiUrl: process.env.API_URL ?? 'http://localhost:4100', db });
const port = numberFromEnv(process.env.PORT, 4200);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => console.log(`[simulator] listening on :${port}`));
