// Deployment migration step (docker entrypoint `migrate`, CI): runs as the OWNER role (MIGRATION_DATABASE_URL)
//   1. applies pending migrations (001 creates the non-superuser role mice_app with a dev password)
//   2. if APP_DB_PASSWORD is set, sets mice_app's password so the API's DATABASE_URL (mice_app) can log in
// The API itself never runs migrations and never connects as the owner.
import pg from 'pg';
import { loadConfig } from '../config.js';
import { migrate } from './migrate.js';

export async function bootstrap(env: Record<string, string | undefined> = process.env, log: (s: string) => void = console.log): Promise<void> {
  const cfg = loadConfig(env);
  const applied = await migrate(cfg.migrationDatabaseUrl, { log });
  log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
  if (env.APP_DB_PASSWORD) {
    const c = new pg.Client({ connectionString: cfg.migrationDatabaseUrl });
    await c.connect();
    try {
      const { rows } = await c.query<{ q: string }>(`SELECT format('ALTER ROLE mice_app PASSWORD %L', $1::text) AS q`, [env.APP_DB_PASSWORD]);
      await c.query(rows[0].q);
      log('mice_app password set from APP_DB_PASSWORD');
    } finally {
      await c.end();
    }
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
