// Q5 follow-up: daily TCMB rate import for every tenant (run once a day after 15:30 Istanbul, e.g. cron / scheduler):
//   npm run fx:tcmb -w @mice/api                 # today.xml
//   npm run fx:tcmb -w @mice/api -- --date=2026-03-06 [--to=2026-03-31]   # archive (kurlar/YYYYMM/DDMMYYYY.xml), day by day
// Weekends / holidays have no bulletin (404) and are skipped; the value-date lookup uses the previous published rate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { closePool, initPool, withTenant, withoutTenant } from '../db/pool.js';
import { makeCtx, type AppDeps } from '../context.js';
import { fetchTcmbXml, importTcmbRates } from '../services/fx-rates.js';

function* days(from: string, to: string): Generator<string> {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) yield new Date(t).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const args = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--')).map((x) => { const [k, ...v] = x.slice(2).split('='); return [k, v.join('=') || 'true']; }));
  initPool(loadConfig().databaseUrl);
  try {
    const tenants = await withoutTenant((db) => db.query<{ app_tenant_ids: string }>('SELECT app_tenant_ids()').then((r) => r.rows.map((x) => x.app_tenant_ids)));
    const dates: (string | undefined)[] = args.date ? [...days(args.date, args.to ?? args.date)] : [undefined];
    const deps = { now: () => new Date(), rng: Math.random } as unknown as AppDeps;
    for (const d of dates) {
      let xml: string;
      try {
        xml = await fetchTcmbXml(d);
      } catch (e) {
        console.log(`${d ?? 'today'}: ${(e as Error).message}`);
        continue;
      }
      for (const t of tenants) {
        const r = await withTenant(t, { type: 'system', id: null }, (db) => importTcmbRates(makeCtx(db, t, null, { type: 'system', id: null }, deps), { xml }));
        console.log(`${t} ${r.date}: ${r.inserted}/${r.rows} kur`);
      }
    }
  } finally {
    await closePool();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
