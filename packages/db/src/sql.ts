import { sql, type SQL } from 'drizzle-orm';

/** `array[$1::uuid, $2::uuid, ...]`, for use as `= any(${uuidList(ids)})`. drizzle expands JS arrays into tuples, which `any()` cannot take. */
export function uuidList(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]`;
}
