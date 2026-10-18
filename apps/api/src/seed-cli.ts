import { createDb, runMigrations } from '@standing/db';
import { SystemClock } from '@standing/shared';
import { seedDemo } from './seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url);
await runMigrations(db);
console.log(await seedDemo(db, new SystemClock()));
await pool.end();
