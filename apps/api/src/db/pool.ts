// Connection pool for the API (role mice_app → RLS always applies) and the tenant-context helper.
import pg from 'pg';
import type { ActorType } from '@mice/shared';

// numeric → number, int8 → number, date → 'YYYY-MM-DD' string (no timezone shifting)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.PoolClient;

export interface Actor {
  type: ActorType;
  /** user id, supplier id, customer token id … */
  id: string | null;
  device?: string | null;
}

let pool: pg.Pool | null = null;
let poolUrl: string | null = null;

export function initPool(databaseUrl: string): pg.Pool {
  if (pool && poolUrl === databaseUrl) return pool;
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  poolUrl = databaseUrl;
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('DB pool not initialised (call initPool)');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    poolUrl = null;
    await p.end();
  }
}

/**
 * Runs `fn` inside a transaction whose RLS context is the given tenant:
 *   SET LOCAL app.tenant_id / app.user_id / app.actor_type / app.device
 * The settings are transaction-scoped, so a pooled connection never carries a tenant to the next request.
 */
/** Injected application clock (tests). When set, DB-generated timestamps (column defaults, audit_log.at) follow it via
 *  `app_now()` (migration 021) so reports that mix app-clock and DB-clock timestamps stay consistent. Production: unset → now(). */
let dbClock: (() => Date) | null = null;
let lastClockValue = NaN;
let lastClockChangeReal = 0;
export function setDbClock(fn: (() => Date) | null): void { dbClock = fn; lastClockValue = NaN; }
/** Injected clock value + real time elapsed since the clock was last set → monotonic across transactions while
 *  staying anchored to the injected clock (a fixed test clock no longer produces identical timestamps). */
function dbNowIso(): string {
  if (!dbClock) return '';
  const c = dbClock().getTime();
  if (c !== lastClockValue) { lastClockValue = c; lastClockChangeReal = Date.now(); }
  return new Date(c + (Date.now() - lastClockChangeReal)).toISOString();
}

export async function withTenant<T>(tenantId: string, actor: Actor, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.actor_type', $3, true), set_config('app.device', $4, true),
              set_config('app.now', $5, true)`,
      [tenantId, actor.id ?? '', actor.type, actor.device ?? '', dbNowIso()],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Temporarily switch the actor inside an open tenant transaction (e.g. AI-authored rows). */
export async function setActor(db: Db, actor: Actor): Promise<void> {
  await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.actor_type', $2, true)`, [actor.id ?? '', actor.type]);
}

/** Queries that run before the tenant is known (SECURITY DEFINER functions only). */
export async function withoutTenant<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
