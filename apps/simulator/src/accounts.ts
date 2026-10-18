import { createHash, randomBytes } from 'node:crypto';
import { schema, type Db } from '@standing/db';

const CHUNK = 1000;

/** Inserts `n` simulated users with a live session each; returns the raw session tokens (only their sha-256 is stored). */
export async function createSimulatedBuyers(db: Db, runId: string, n: number, now: Date = new Date()): Promise<string[]> {
  const tokens: string[] = [];
  for (let start = 0; start < n; start += CHUNK) {
    const size = Math.min(CHUNK, n - start);
    const users = await db
      .insert(schema.users)
      .values(
        Array.from({ length: size }, (_, i) => ({
          email: `sim-${runId}-${start + i}@sim.standing.local`,
          passwordHash: '!', // never a valid hash: password login is impossible
          name: `Sim Buyer ${start + i + 1}`,
          isSimulated: true,
        })),
      )
      .returning({ id: schema.users.id });
    const chunkTokens = users.map(() => randomBytes(24).toString('base64url'));
    await db.insert(schema.sessions).values(
      users.map((u, i) => ({
        userId: u.id,
        tokenHash: createHash('sha256').update(chunkTokens[i] ?? '').digest('hex'),
        expiresAt: new Date(now.getTime() + 24 * 3600_000),
      })),
    );
    tokens.push(...chunkTokens);
  }
  return tokens;
}
