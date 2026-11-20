// Migration runner: applies src/db/migrations/*.sql in lexical order, each in its own transaction,
// and records them in schema_migrations (name + sha256 checksum). Runs as the owner/superuser role.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from '../config.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(databaseUrl: string, opts: { log?: (s: string) => void } = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    // serialize concurrent runners
    await client.query('SELECT pg_advisory_lock(424242)');
    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== checksum) log(`WARNING: migration ${f} changed after being applied (checksum mismatch)`);
        continue;
      }
      log(`applying ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, checksum]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(424242)');
  } finally {
    await client.end();
  }
  return applied;
}

/** Drops and recreates the public schema (tests / `migrate --fresh`). */
export async function resetSchema(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cfg = loadConfig();
  const fresh = process.argv.includes('--fresh');
  (async () => {
    if (fresh) {
      console.log('dropping schema (--fresh)');
      await resetSchema(cfg.migrationDatabaseUrl);
    }
    const applied = await migrate(cfg.migrationDatabaseUrl, { log: console.log });
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
