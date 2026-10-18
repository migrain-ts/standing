import { Pool } from 'pg';
import { createDb } from './client';
import { runMigrations } from './migrate';

const admin = () =>
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://standing:standing@localhost:5441/postgres';

export const TEMPLATE = 'standing_template';

export default async function setup() {
  const pool = new Pool({ connectionString: admin(), max: 1 });
  await pool.query(`drop database if exists ${TEMPLATE} with (force)`);
  await pool.query(`create database ${TEMPLATE}`);
  await pool.end();
  const url = new URL(admin());
  url.pathname = `/${TEMPLATE}`;
  const { db, pool: tpl } = createDb(url.toString());
  await runMigrations(db);
  await tpl.end();
}
