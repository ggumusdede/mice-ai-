// Fresh mice_test schema for every run (records cannot be deleted row by row — §3.6 — so we drop the schema).
import { migrate, resetSchema } from '../src/db/migrate.js';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/mice_test';
  await resetSchema(url);
  await migrate(url);
}
