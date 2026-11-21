// Liveness / readiness.
//   GET /api/health — liveness (always 200 while the process serves): { ok, status, db, uptimeS }
//   GET /api/ready  — readiness: 200 only when the DB answers, every shipped migration is applied and the process is not
//                     shutting down; else 503 (load balancer / compose healthcheck stop routing traffic).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
let shuttingDown = false;
export function markShuttingDown(): void {
  shuttingDown = true;
}

async function dbStatus(): Promise<'up' | 'down'> {
  try {
    await Promise.race([
      getPool().query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000).unref()),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}

async function pendingMigrations(): Promise<string[] | null> {
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
    const applied = new Set((await getPool().query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    return files.filter((f) => !applied.has(f)).sort();
  } catch {
    return null; // schema_migrations not readable (older DB without the 006 grant) → unknown
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const quiet = { logLevel: 'warn' as const };
  app.get('/api/health', quiet, async () => {
    const db = await dbStatus();
    return { ok: true, status: shuttingDown ? 'shutting_down' : 'ok', db, uptimeS: Math.round(process.uptime()) };
  });
  app.get('/api/ready', quiet, async (_req, reply) => {
    const db = await dbStatus();
    const pending = db === 'up' ? await pendingMigrations() : null;
    const ready = !shuttingDown && db === 'up' && (pending === null || pending.length === 0);
    reply.status(ready ? 200 : 503);
    return { ready, db, pendingMigrations: pending ?? 'unknown', shuttingDown };
  });
}
