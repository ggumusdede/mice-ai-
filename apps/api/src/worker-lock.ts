// Worker leader lock (security / platform review G-20, multi-instance deploys). Several worker containers may run (rolling
// deploys, `docker compose up --scale worker=2`); jobs such as the autonomous RFQ reminder, digests or outbox retries must
// run in ONE of them only. The leader holds a session-level `pg_try_advisory_lock` on a dedicated connection for as long
// as it lives; a standby retries on every tick and takes over when the leader's connection ends (crash, shutdown).
import type pg from 'pg';

/** Arbitrary, fixed 64-bit key ("MICEWRKR"); the migration runner uses 424242. */
export const WORKER_LOCK_KEY = '5570565158738284370';

export interface LeaderLock {
  /** true while this process holds the lock */
  readonly held: boolean;
  /** tries to become (or confirms being) the leader */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export function createLeaderLock(pool: pg.Pool, key: string = WORKER_LOCK_KEY): LeaderLock {
  let client: pg.PoolClient | null = null;
  const drop = (c: pg.PoolClient, err?: Error) => {
    if (client === c) client = null;
    try {
      c.release(err ?? true); // destroy the connection: a session lock must not go back to the pool
    } catch {
      /* already released */
    }
  };
  return {
    get held() {
      return client !== null;
    },
    async acquire() {
      if (client) {
        try {
          await client.query('SELECT 1'); // still connected → still the leader (lock is bound to this session)
          return true;
        } catch (e) {
          drop(client, e as Error);
        }
      }
      const c = await pool.connect();
      try {
        const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS ok', [key]);
        if (!rows[0]?.ok) {
          c.release();
          return false;
        }
        c.on('error', (e) => drop(c, e));
        client = c;
        return true;
      } catch (e) {
        drop(c, e as Error);
        return false;
      }
    },
    async release() {
      const c = client;
      if (!c) return;
      client = null;
      try {
        await c.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
        c.release();
      } catch (e) {
        drop(c, e as Error);
      }
    },
  };
}
