import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';

/** Must run outside a transaction (`refresh ... concurrently` refuses to). The view is created populated by the migration. */
export const refreshDailySales = async (db: Db): Promise<void> => {
  await db.execute(sql`refresh materialized view concurrently daily_sales_mv`);
};
