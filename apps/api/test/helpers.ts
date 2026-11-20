import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { CapturingEmailProvider } from '../src/services/email.js';
import { seedBaseTenant, seedChannelPrices, type SeededTenant } from '../src/db/seed-data.js';
import { closePool } from '../src/db/pool.js';

export const OWNER_URL = process.env.MIGRATION_DATABASE_URL!;
export const APP_URL = process.env.DATABASE_URL!;

export const clock = { now: new Date('2026-11-20T07:00:00Z') }; // Friday 10:00 Istanbul
export function advanceHours(h: number): void {
  clock.now = new Date(clock.now.getTime() + h * 3_600_000);
}
export function resetClock(): void {
  clock.now = new Date('2026-11-20T07:00:00Z');
}
export const rng = { value: 0.99 };

export interface TestApp {
  app: FastifyInstance;
  email: CapturingEmailProvider;
}

export async function makeApp(): Promise<TestApp> {
  const email = new CapturingEmailProvider();
  const app = await buildApp({ email, now: () => clock.now, rng: () => rng.value, logger: false });
  return { app, email };
}

export async function closeApp(t: TestApp): Promise<void> {
  await t.app.close();
  await closePool();
}

let counter = 0;
export async function newTenant(label: string): Promise<SeededTenant & { domain: string }> {
  const slug = `${label}-${Date.now().toString(36)}-${counter++}`;
  const domain = `${slug}.test`;
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    const t = await seedBaseTenant(c, { name: `Test ${label}`, slug, emailDomain: domain, fxDate: '2026-11-19' });
    await seedChannelPrices(c, t.tenantId, t.suppliers, '2027-03-12', 2);
    return { ...t, domain };
  } finally {
    await c.end();
  }
}

/** Owner (superuser) SQL — bypasses RLS; used only to arrange/inspect state. */
export async function ownerSql<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** SQL as the application role mice_app with a tenant context (RLS applies). tenantId null → no context. */
export async function appSql<T = Record<string, any>>(tenantId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: APP_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

export async function login(app: FastifyInstance, email: string, password = 'demo1234'): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`);
  return r.json().token;
}

export interface Res<T = any> { status: number; body: T }

export function client(app: FastifyInstance, token?: string) {
  const call = async <T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<Res<T>> => {
    const r = await app.inject({ method, url, payload: payload as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
    let body: any = r.body;
    try {
      body = r.json();
    } catch {
      /* binary */
    }
    return { status: r.statusCode, body };
  };
  return {
    get: <T = any>(url: string) => call<T>('GET', url),
    post: <T = any>(url: string, payload?: unknown) => call<T>('POST', url, payload ?? {}),
    patch: <T = any>(url: string, payload?: unknown) => call<T>('PATCH', url, payload ?? {}),
    del: <T = any>(url: string) => call<T>('DELETE', url),
  };
}
export type Client = ReturnType<typeof client>;

export const REQUEST_TEXT = "Merhaba, 12-14 Mart 2027 tarihlerinde Kadıköy'de 80 kişilik iki günlük toplantı için teklif rica ediyoruz. 30 SGL 25 DBL oda, tiyatro düzeni salon, öğle yemeği ve 2 coffee break, havalimanı transferi. Bütçe kişi başı 250 EUR. Firma: Anadolu İlaç";

export const accLines = (dbl = 105, sgl = 90) => [
  { description: 'Oda (DBL, BB)', kind: 'accommodation', quantity: 25, unit: 'room_night', nights: 2, unitPrice: dbl, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB' },
  { description: 'Oda (SGL, BB)', kind: 'accommodation', quantity: 30, unit: 'room_night', nights: 2, unitPrice: sgl, vatIncluded: false, vatRate: 0.1, roomType: 'SGL', board: 'BB' },
];
export const hallLines = (price = 1300) => [{ description: 'Salon (tiyatro)', kind: 'hall', quantity: 2, unit: 'day', unitPrice: price, vatIncluded: false, vatRate: 0.2 }];

export interface Quotable {
  projectId: string;
  accItemId: string;
  hallItemId: string;
  accOffers: Record<string, string>;
  hallOfferId: string;
}

/** Intake + offers for accommodation (moda, kalamis, galata[candidate]) and hall (moda); moda selected. */
export async function quotableProject(api: Client, t: SeededTenant, customer: keyof SeededTenant['customers'] = 'new', text = REQUEST_TEXT): Promise<Quotable> {
  const intake = await api.post('/api/intake', { channel: 'email', body: text, fromAddress: 'musteri@example.com', customerId: t.customers[customer] });
  if (intake.status !== 200) throw new Error(`intake ${intake.status} ${JSON.stringify(intake.body)}`);
  const projectId = intake.body.project.id;
  const detail = await api.get(`/api/projects/${projectId}`);
  const acc = detail.body.items.find((i: any) => i.kind === 'accommodation');
  const hall = detail.body.items.find((i: any) => i.kind === 'hall');
  const accOffers: Record<string, string> = {};
  for (const [key, dbl, sgl, opt] of [['moda', 105, 90, '2027-01-20'], ['kalamis', 150, 130, '2027-01-25'], ['galata', 100, 85, '2027-01-18']] as const) {
    const r = await api.post(`/api/items/${acc.id}/offers`, { supplierId: t.suppliers[key], source: 'email', currency: 'EUR', lines: accLines(dbl, sgl), optionUntil: opt, guaranteePax: 70, prepaymentRate: 0.3, paymentTerms: '%30 ön ödeme' });
    if (r.status !== 200) throw new Error(`offer ${r.status} ${JSON.stringify(r.body)}`);
    accOffers[key] = r.body.id;
  }
  const h = await api.post(`/api/items/${hall.id}/offers`, { supplierId: t.suppliers.moda, source: 'email', currency: 'EUR', lines: hallLines(), optionUntil: '2027-01-20' });
  await api.post(`/api/items/${acc.id}/select-offer`, { offerId: accOffers.moda });
  await api.post(`/api/items/${hall.id}/select-offer`, { offerId: h.body.id });
  return { projectId, accItemId: acc.id, hallItemId: hall.id, accOffers, hallOfferId: h.body.id };
}

export function twoOptions(q: Quotable, markup = 0.2, accOffer?: string) {
  return {
    options: [
      { title: 'Seçenek A', lines: [{ serviceItemId: q.accItemId, offerId: accOffer ?? q.accOffers.moda, markup }, { serviceItemId: q.hallItemId, offerId: q.hallOfferId, markup }] },
      { title: 'Seçenek B', lines: [{ serviceItemId: q.accItemId, offerId: q.accOffers.kalamis, markup }, { serviceItemId: q.hallItemId, offerId: q.hallOfferId, markup }] },
    ],
  };
}
