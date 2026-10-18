import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createDb, type Db } from './client';

const admin = () =>
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://standing:standing@localhost:5441/postgres';

export async function createTestDb(): Promise<{ db: Db; pool: Pool; url: string; close(): Promise<void> }> {
  const name = `standing_test_${randomBytes(6).toString('hex')}`;
  const adminPool = new Pool({ connectionString: admin(), max: 1 });
  await adminPool.query(`create database ${name} template standing_template`);
  const url = new URL(admin());
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString());
  return {
    db,
    pool,
    url: url.toString(),
    async close() {
      await pool.end();
      await adminPool.query(`drop database if exists ${name} with (force)`);
      await adminPool.end();
    },
  };
}
