// Base tenant data (used by `npm run seed` and by tests). Runs on an OWNER connection (bypasses RLS) and is idempotent
// per tenant slug. Business demo projects are created afterwards through the real services (src/db/seed.ts).
import type pg from 'pg';
import { DEFAULT_RULES } from '@mice/shared';
import { hashPassword } from '../lib/crypto.js';

export interface SeedOptions {
  name: string;
  slug: string;
  /** e-mail domain for the 5 users, e.g. 'demo.test' → admin@demo.test */
  emailDomain: string;
  password?: string;
  fxDate?: string;
}

export interface SeededTenant {
  tenantId: string;
  users: Record<'admin' | 'clerk' | 'ops' | 'field' | 'finance', { id: string; email: string }>;
  suppliers: Record<string, string>;
  customers: Record<'new' | 'trusted' | 'deposit', string>;
}

type Db = pg.ClientBase;

const SUPPLIERS = [
  { key: 'moda', name: 'Moda Sahil Otel', kinds: ['accommodation', 'hall', 'fnb'], district: 'Kadıköy', segment: '4*', rooms: 120, pax: 250, status: 'accredited', score: 82, resp: 6 },
  { key: 'kalamis', name: 'Kalamış Marina Hotel', kinds: ['accommodation', 'hall', 'fnb'], district: 'Kadıköy', segment: '5*', rooms: 180, pax: 400, status: 'accredited', score: 88, resp: 4 },
  { key: 'bomonti', name: 'Bomonti Kongre Otel', kinds: ['accommodation', 'hall', 'fnb', 'technical'], district: 'Şişli', segment: '5*', rooms: 400, pax: 1200, status: 'accredited', score: 90, resp: 3 },
  { key: 'nisantasi', name: 'Nişantaşı Butik Otel', kinds: ['accommodation', 'fnb'], district: 'Şişli', segment: 'butik', rooms: 45, pax: 60, status: 'accredited', score: 75, resp: 12 },
  { key: 'bogaz', name: 'Boğaz Palas Otel', kinds: ['accommodation', 'hall', 'fnb'], district: 'Beşiktaş', segment: '5*', rooms: 260, pax: 600, status: 'accredited', score: 86, resp: 5 },
  { key: 'ortakoy', name: 'Ortaköy Business Hotel', kinds: ['accommodation', 'hall', 'fnb'], district: 'Beşiktaş', segment: '4*', rooms: 150, pax: 300, status: 'accredited', score: 70, resp: 10 },
  { key: 'tarabya', name: 'Tarabya Koru Otel', kinds: ['accommodation', 'hall', 'fnb', 'activity'], district: 'Sarıyer', segment: '5*', rooms: 220, pax: 500, status: 'accredited', score: 84, resp: 7 },
  { key: 'atasehir', name: 'Ataşehir Finans Otel', kinds: ['accommodation', 'hall', 'fnb'], district: 'Ataşehir', segment: '4*', rooms: 200, pax: 350, status: 'accredited', score: 78, resp: 8 },
  { key: 'galata', name: 'Galata Konak Otel', kinds: ['accommodation', 'hall'], district: 'Beyoğlu', segment: 'butik', rooms: 40, pax: 80, status: 'candidate', score: null, resp: null },
  { key: 'transfer', name: 'İstanbul VIP Transfer', kinds: ['transfer'], district: 'Bakırköy', segment: null, rooms: null, pax: null, status: 'accredited', score: 80, resp: 2 },
  { key: 'av', name: 'SesIşık Teknik Prodüksiyon', kinds: ['technical'], district: 'Kağıthane', segment: null, rooms: null, pax: null, status: 'accredited', score: 83, resp: 6 },
  { key: 'tekne', name: 'Boğaz Tekne Turları', kinds: ['activity', 'fnb'], district: 'Beşiktaş', segment: null, rooms: null, pax: 150, status: 'accredited', score: 77, resp: 9 },
] as const;

const CHECKLIST: { eventType: string | null; question: string; field: string | null }[] = [
  { eventType: null, question: 'Karar tarihiniz nedir?', field: 'decisionDate' },
  { eventType: null, question: 'Fatura bilgilerini (unvan, vergi dairesi, no) paylaşabilir misiniz?', field: 'billingInfo' },
  { eventType: null, question: 'Havalimanı / şehir içi transfer ihtiyacı var mı?', field: 'transfer' },
  { eventType: null, question: 'Teknik ihtiyaçlar (projeksiyon, ses, LED) nelerdir?', field: 'technical' },
  { eventType: 'toplantı', question: 'Salon düzeni nasıl olmalı (tiyatro, sınıf, U)?', field: 'hallLayout' },
  { eventType: 'toplantı', question: 'Yiyecek-içecek beklentiniz (coffee break, öğle yemeği) nedir?', field: 'fnb' },
];

async function one(db: Db, sql: string, params: unknown[]): Promise<string> {
  return (await db.query(sql, params)).rows[0].id;
}

export async function seedBaseTenant(db: Db, o: SeedOptions): Promise<SeededTenant> {
  const existing = (await db.query('SELECT id FROM tenants WHERE slug = $1', [o.slug])).rows[0];
  if (existing) return loadSeeded(db, existing.id, o.emailDomain);
  const tenantId = await one(db, `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [o.name, o.slug]);
  await db.query(`SELECT set_config('app.tenant_id', $1, false), set_config('app.actor_type', 'system', false)`, [tenantId]);
  for (const [key, value] of Object.entries(DEFAULT_RULES)) {
    await db.query('INSERT INTO rules (tenant_id, key, value) VALUES ($1, $2, $3::jsonb)', [tenantId, key, JSON.stringify(value)]);
  }
  const fxDate = o.fxDate ?? new Date().toISOString().slice(0, 10);
  for (const [cur, rate] of [['TRY', 48.5], ['USD', 1.08], ['GBP', 0.86]] as const) {
    await db.query('INSERT INTO fx_rates (tenant_id, currency, rate, source, rate_date) VALUES ($1,$2,$3,$4,$5)', [tenantId, cur, rate, 'TCMB efektif satış (seed)', fxDate]);
  }
  const pw = await hashPassword(o.password ?? 'demo1234');
  const users = {} as SeededTenant['users'];
  const userDefs = [
    ['admin', 'Ayşe Yılmaz', 'admin', 'full', true],
    ['clerk', 'Mehmet Demir', 'clerk_sales', 'scoped', false],
    ['ops', 'Elif Kaya', 'clerk_ops', 'all_need_approval', false],
    ['field', 'Can Öztürk', 'field', 'all_need_approval', false],
    ['finance', 'Zeynep Arslan', 'finance', 'all_need_approval', false],
  ] as const;
  for (const [key, fullName, role, level, canSign] of userDefs) {
    const email = `${key}@${o.emailDomain}`;
    const id = await one(db,
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, authority_level, can_sign, languages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenantId, email, pw, fullName, role, level, canSign, key === 'admin' ? ['tr', 'en', 'ru'] : ['tr', 'en']]);
    users[key] = { id, email };
  }
  const suppliers: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    suppliers[s.key] = await one(db,
      `INSERT INTO suppliers (tenant_id, name, kinds, city, district, room_count, capacity_pax, halls, status, segment, email, phone, contact_name,
         commission, payment_terms, performance_score, avg_response_hours, accredited_by, accredited_at)
       VALUES ($1,$2,$3,'İstanbul',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [tenantId, s.name, s.kinds, s.district, s.rooms, s.pax,
        JSON.stringify((s.kinds as readonly string[]).includes('hall') ? [{ name: 'Ana Salon', capacityTheatre: s.pax, capacityClassroom: s.pax ? Math.round(s.pax * 0.6) : undefined, capacityBanquet: s.pax ? Math.round(s.pax * 0.7) : undefined }] : []),
        s.status, s.segment, `satis@${s.key}.example.com`, '+90 212 555 00 00', 'Satış Müdürü',
        JSON.stringify((s.kinds as readonly string[]).includes('accommodation') ? { rate: 0.1, vatIncluded: false, billedSeparately: true } : null),
        '%30 ön ödeme, bakiye etkinlikten 7 gün önce', s.score, s.resp,
        s.status === 'accredited' ? users.admin.id : null, s.status === 'accredited' ? new Date() : null]);
  }
  const customers = {} as SeededTenant['customers'];
  customers.new = await one(db,
    `INSERT INTO customers (tenant_id, name, short_code, tax_office, tax_number, billing_address, contacts) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenantId, 'Anadolu İlaç A.Ş.', 'ANADOLUILAC', 'Kozyatağı', '1112223334', 'Kozyatağı Mah. Değirmen Sok. No:1 Kadıköy/İstanbul', JSON.stringify([{ name: 'Selin Aydın', email: `selin@anadolu-ilac.${o.emailDomain}`, title: 'İK Müdürü' }])]);
  customers.trusted = await one(db,
    `INSERT INTO customers (tenant_id, name, short_code, tax_office, tax_number, billing_address, contacts, rules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [tenantId, 'Marmara Teknoloji A.Ş.', 'MARMARATEK', 'Maslak', '5556667778', 'Maslak Mah. Büyükdere Cad. No:200 Sarıyer/İstanbul', JSON.stringify([{ name: 'Burak Şahin', email: `burak@marmara-tek.${o.emailDomain}`, title: 'Etkinlik Sorumlusu' }]),
      JSON.stringify({ firmApproval: 'online', depositRate: 0, omitPaymentCancellationClauses: true, specialClauses: ['Fiyatlara KDV dahil değildir.'], preferredLanguage: 'tr', preferredCurrency: 'EUR' })]);
  customers.deposit = await one(db,
    `INSERT INTO customers (tenant_id, name, short_code, tax_office, tax_number, billing_address, contacts, rules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [tenantId, 'Ege Otomotiv San. A.Ş.', 'EGEOTO', 'Bornova', '9990001112', 'Kemalpaşa Cad. No:5 Bornova/İzmir', JSON.stringify([{ name: 'Deniz Koç', email: `deniz@ege-oto.${o.emailDomain}` }]),
      JSON.stringify({ firmApproval: 'signed_or_po', depositRate: 0.3, omitPaymentCancellationClauses: false, specialClauses: [], preferredLanguage: 'tr', preferredCurrency: 'TRY' })]);
  // the sales clerk may send quotes for the trusted customer without approval (§4 'scoped')
  await db.query(`UPDATE users SET authority_scope = $2 WHERE id = $1`, [users.clerk.id, JSON.stringify({ customerIds: [customers.trusted], eventTypes: [] })]);

  for (const c of CHECKLIST) {
    await db.query(`INSERT INTO checklist_questions (tenant_id, event_type, question, field, status, source) VALUES ($1,$2,$3,$4,'active','seed')`, [tenantId, c.eventType, c.question, c.field]);
  }

  // price history (verified, last 12–18 months closed projects) — basis for "iyi fiyat" on non-accommodation items
  const hist: [string, string, string, number][] = [
    ['moda', 'hall', 'day', 1400], ['kalamis', 'hall', 'day', 1900], ['bomonti', 'hall', 'day', 2400], ['bogaz', 'hall', 'day', 2100], ['ortakoy', 'hall', 'day', 1600],
    ['tarabya', 'hall', 'day', 2000], ['atasehir', 'hall', 'day', 1500],
    ['moda', 'fnb', 'pax_day', 38], ['kalamis', 'fnb', 'pax_day', 46], ['bomonti', 'fnb', 'pax_day', 52], ['bogaz', 'fnb', 'pax_day', 49], ['ortakoy', 'fnb', 'pax_day', 41],
    ['tarabya', 'fnb', 'pax_day', 47], ['atasehir', 'fnb', 'pax_day', 40], ['transfer', 'transfer', 'vehicle', 65], ['transfer', 'transfer', 'vehicle', 70],
    ['av', 'technical', 'lump_sum', 1800], ['av', 'technical', 'lump_sum', 2200],
  ];
  for (const [key, kind, unit, price] of hist) {
    for (const [i, f] of [0.95, 1.0, 1.05].entries()) {
      await db.query(
        `INSERT INTO price_history (tenant_id, supplier_id, kind, description, city, district, segment, season, service_date, unit, price_type, unit_price, currency, unit_price_eur, verified)
         VALUES ($1,$2,$3,$4,'İstanbul',$5,$6,$7,$8,$9,$10,$11,'EUR',$11,true)`,
        [tenantId, suppliers[key], kind, `${kind} (geçmiş proje)`, SUPPLIERS.find((s) => s.key === key)!.district, SUPPLIERS.find((s) => s.key === key)!.segment,
          i === 1 ? 'high' : 'low', `2026-0${3 + i}-15`, unit, i === 2 ? 'realized' : 'negotiated', Math.round(price * f * 100) / 100]);
    }
  }
  return { tenantId, users, suppliers, customers };
}

/** Channel prices (OTA snapshot, identical conditions) for accommodation suppliers over a date range. */
export async function seedChannelPrices(db: Db, tenantId: string, supplierIds: Record<string, string>, from: string, nights: number): Promise<void> {
  const base: Record<string, number> = { moda: 125, kalamis: 175, bomonti: 190, nisantasi: 160, bogaz: 210, ortakoy: 130, tarabya: 185, atasehir: 120, galata: 140 };
  for (const [key, price] of Object.entries(base)) {
    if (!supplierIds[key]) continue;
    for (let n = 0; n < nights; n++) {
      const d = new Date(Date.parse(from + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
      for (const [room, f] of [['DBL', 1], ['SGL', 0.85]] as const) {
        await db.query(
          `INSERT INTO channel_prices (tenant_id, supplier_id, stay_date, room_type, board, cancellation, price, currency, price_eur, source)
           VALUES ($1,$2,$3,$4,'BB','flexible',$5,'EUR',$5,'Booking.com (manuel kayıt)')`,
          [tenantId, supplierIds[key], d, room, Math.round(price * f)]);
      }
    }
  }
}

async function loadSeeded(db: Db, tenantId: string, domain: string): Promise<SeededTenant> {
  const users = {} as SeededTenant['users'];
  for (const k of ['admin', 'clerk', 'ops', 'field', 'finance'] as const) {
    const r = (await db.query('SELECT id, email FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, `${k}@${domain}`])).rows[0];
    users[k] = r;
  }
  const suppliers: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const r = (await db.query('SELECT id FROM suppliers WHERE tenant_id = $1 AND name = $2', [tenantId, s.name])).rows[0];
    if (r) suppliers[s.key] = r.id;
  }
  const c = async (code: string) => (await db.query('SELECT id FROM customers WHERE tenant_id = $1 AND short_code = $2', [tenantId, code])).rows[0]?.id;
  return { tenantId, users, suppliers, customers: { new: await c('ANADOLUILAC'), trusted: await c('MARMARATEK'), deposit: await c('EGEOTO') } };
}
