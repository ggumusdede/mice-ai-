// Deployment migration step (docker entrypoint `migrate`, CI): runs as the OWNER role (MIGRATION_DATABASE_URL)
//   1. applies pending migrations (001 creates the non-superuser role mice_app with a dev password)
//   2. if APP_DB_PASSWORD is set, sets mice_app's password so the API's DATABASE_URL (mice_app) can log in
// The API itself never runs migrations and never connects as the owner.
import pg from 'pg';
import { migrate } from './migrate.js';

export async function bootstrap(env: Record<string, string | undefined> = process.env, log: (s: string) => void = console.log): Promise<void> {
  // only the owner connection is needed here (no JWT / data keys: the migrate container never gets the app secrets)
  const url = env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/mice';
  const applied = await migrate(url, { log });
  log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
  if (env.APP_DB_PASSWORD) {
    const c = new pg.Client({ connectionString: url });
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
