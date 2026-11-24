// Demo seed: `npm run seed` (idempotent: skips when the demo tenant exists) or `npm run seed -- --reset`
// (drops & re-migrates the schema first — records are never deleted row by row, §3.6).
// Base data is inserted on the owner connection; demo projects go through the REAL services (mock AI by default).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { createAiService } from '@mice/ai';
import type { OfferLine } from '@mice/shared';
import { loadConfig } from '../config.js';
import { migrate, resetSchema } from './migrate.js';
import { closePool, initPool } from './pool.js';
import { seedBaseTenant, seedChannelPrices, type SeededTenant } from './seed-data.js';
import { withSystemCtx, withUserCtx, type AppDeps, type Ctx } from '../context.js';
import { OutboxEmailProvider } from '../services/email.js';
import { registerAll } from '../services/registry.js';
import { runIntake } from '../services/intake.js';
import { manualOffer } from '../services/offers.js';
import { createItem, selectOffer } from '../services/items.js';
import { buildQuote, publicAccept, sendQuote } from '../services/quotes.js';
import { createContract, parseContract } from '../services/contracts.js';
import { assignProject } from '../services/projects.js';

const acc = (room: 'DBL' | 'SGL', qty: number, nights: number, price: number): OfferLine => ({
  description: `Oda (${room}, BB)`, kind: 'accommodation', quantity: qty, unit: 'room_night', nights, unitPrice: price, vatIncluded: false, vatRate: 0.1, roomType: room, board: 'BB',
});
const line = (kind: OfferLine['kind'], description: string, qty: number, unit: string, price: number, nights?: number): OfferLine => ({
  description, kind, quantity: qty, unit, unitPrice: price, vatIncluded: false, vatRate: 0.2, ...(nights ? { nights } : {}),
});

async function items(ctx: Ctx, projectId: string) {
  return (await ctx.db.query('SELECT * FROM service_items WHERE project_id = $1 ORDER BY sort', [projectId])).rows;
}

export async function seedDemoProjects(deps: AppDeps, t: SeededTenant): Promise<void> {
  const asAdmin = <T>(fn: (ctx: Ctx) => Promise<T>) => withUserCtx(deps, { userId: t.users.admin.id, tenantId: t.tenantId }, 'seed', fn, { skipTokenVersion: true });
  const S = t.suppliers;

  // 1) offers ready to quote (Marmara Teknoloji, Kadıköy, step 2)
  await asAdmin(async (ctx) => {
    const r = await runIntake(ctx, {
      channel: 'email', customerId: t.customers.trusted, fromAddress: 'burak@marmara-tek.example.com', subject: 'Bayi toplantısı teklif talebi',
      body: "Merhaba, 12-14 Mart 2027 tarihlerinde Kadıköy'de 80 kişilik iki günlük toplantı için teklif rica ediyoruz. 30 SGL 25 DBL oda, tiyatro düzeni salon, öğle yemeği ve 2 coffee break, havalimanı transferi. Bütçe kişi başı 250 EUR. Karar tarihi 15 Ocak 2027. Fatura: Marmara Teknoloji A.Ş., Maslak V.D. 5556667778",
    });
    await assignProject(ctx, r.project.id, t.users.clerk.id);
    const its = await items(ctx, r.project.id);
    const accItem = its.find((i) => i.kind === 'accommodation');
    const hall = its.find((i) => i.kind === 'hall');
    if (accItem) {
      for (const [key, dbl, sgl, opt] of [['moda', 105, 90, '2027-01-20'], ['kalamis', 150, 130, '2027-01-25'], ['galata', 118, 100, '2027-01-18']] as const) {
        const o = await manualOffer(ctx, accItem.id, { supplierId: S[key], rfqId: null, source: 'email', currency: 'EUR', lines: [acc('DBL', 25, 2, dbl), acc('SGL', 30, 2, sgl)], optionUntil: opt, guaranteePax: 70, attritionTerms: '%10 düşüş 21 gün öncesine kadar', paymentTerms: '%30 ön ödeme', prepaymentRate: 0.3, cancellationTerms: '30 gün öncesine kadar ücretsiz', overtimeTerms: null, notes: null });
        if (key === 'moda') await selectOffer(ctx, accItem.id, o.id);
      }
    }
    if (hall) {
      const o = await manualOffer(ctx, hall.id, { supplierId: S.moda, rfqId: null, source: 'email', currency: 'EUR', lines: [line('hall', 'Toplantı salonu (tiyatro)', 2, 'day', 1300)], optionUntil: '2027-01-20', guaranteePax: null, attritionTerms: null, paymentTerms: null, prepaymentRate: null, cancellationTerms: null, overtimeTerms: '18:00 sonrası saatlik 200 EUR', notes: null });
      await selectOffer(ctx, hall.id, o.id);
    }
  });

  // 2) awaiting contract compare (Anadolu İlaç, Şişli, step 5)
  let quoteToken: string | null = null;
  let projectId = '';
  await asAdmin(async (ctx) => {
    const r = await runIntake(ctx, {
      channel: 'email', customerId: t.customers.new, fromAddress: 'selin@anadolu-ilac.example.com', subject: 'Yıllık satış toplantısı',
      body: "Merhaba, 20-22 Nisan 2027 tarihlerinde Şişli'de 120 kişilik iki günlük toplantı planlıyoruz. 40 SGL 40 DBL oda, sınıf düzeni salon, öğle yemeği ve coffee break. Bütçe 60.000 EUR. Firma: Anadolu İlaç",
    });
    projectId = r.project.id;
    await assignProject(ctx, projectId, t.users.clerk.id);
    const its = await items(ctx, projectId);
    const lines: { serviceItemId: string; offerId: string }[] = [];
    for (const it of its) {
      let offerLines: OfferLine[] | null = null;
      if (it.kind === 'accommodation') offerLines = [acc('DBL', 40, 2, 165), acc('SGL', 40, 2, 145)];
      if (it.kind === 'hall') offerLines = [line('hall', 'Kongre salonu (sınıf)', 2, 'day', 2200)];
      if (it.kind === 'fnb') offerLines = [line('fnb', 'Öğle yemeği + 2 coffee break', 120, 'pax_day', 48, 2)];
      if (!offerLines) continue;
      const o = await manualOffer(ctx, it.id, { supplierId: S.bomonti, rfqId: null, source: 'pdf', currency: 'EUR', lines: offerLines, optionUntil: '2027-02-28', guaranteePax: 100, attritionTerms: '%10', paymentTerms: '%30 ön ödeme, bakiye 7 gün önce', prepaymentRate: 0.3, cancellationTerms: '30 gün öncesine kadar ücretsiz', overtimeTerms: null, notes: null });
      await selectOffer(ctx, it.id, o.id);
      lines.push({ serviceItemId: it.id, offerId: o.id });
    }
    const value = await createItem(ctx, projectId, { kind: 'technical', description: 'Ses-ışık sistemi (otel ücretsiz veriyor)', quantity: 1, unit: 'lump_sum', valueAdd: true });
    const q = await buildQuote(ctx, projectId, {
      options: [
        { title: 'Bomonti — standart', lines: lines.map((l) => ({ ...l })) },
        { title: 'Bomonti — ses-ışık dahil', lines: [...lines.map((l) => ({ ...l })), { serviceItemId: value.id, offerId: null, unitPriceEur: 900 }] },
      ],
    });
    const sent = await sendQuote(ctx, q.id);
    quoteToken = sent.approvalLink?.split('/q/')[1] ?? null;
  });
  if (quoteToken) {
    await withSystemCtx(deps, t.tenantId, { type: 'customer', id: null }, async (ctx) => {
      const quoteId = (await ctx.db.query(`SELECT id FROM quotes WHERE project_id = $1 AND status = 'sent'`, [projectId])).rows[0].id;
      await publicAccept(ctx, quoteId, { optionNo: 2, approverName: 'Selin Aydın', poNumber: 'PO-2027-0042' });
    });
    await asAdmin(async (ctx) => {
      const its = (await items(ctx, projectId)).filter((i) => !i.value_add);
      const c = await createContract(ctx, projectId, { supplierId: S.bomonti, serviceItemIds: its.map((i) => i.id), template: 'supplier' });
      await parseContract(ctx, c.id, {
        text: `KONAKLAMA VE TOPLANTI SÖZLEŞMESİ\nOtel: Bomonti Kongre Otel\nMüşteri: Anadolu İlaç A.Ş.\nGiriş: 20.04.2027  Çıkış: 22.04.2027\nKatılımcı: 120 kişi, garanti 110 kişi\n40 DBL oda x 2 gece x 165 EUR (BB)\n35 SGL oda x 2 gece x 145 EUR (BB)\nSalon kirası: 2.200 EUR (sınıf düzeni)\nFiyatlar KDV hariçtir.\nÖdeme: %50 ön ödeme imzada.\nİptal: 45 günden az kalan iptallerde %100.`,
      });
    });
  }

  // 3) fresh request with missing info (step 0)
  await asAdmin(async (ctx) => {
    await runIntake(ctx, { channel: 'whatsapp', body: 'Selam, Mayıs ayında Sarıyer tarafında 40 kişilik bir yönetim kurulu toplantısı + akşam yemeği düşünüyoruz. Ege Otomotiv', fromAddress: '+90 532 000 00 00' });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    const config = loadConfig();
    if (process.argv.includes('--reset')) {
      console.log('resetting schema…');
      await resetSchema(config.migrationDatabaseUrl);
    }
    await migrate(config.migrationDatabaseUrl, { log: console.log });
    const client = new pg.Client({ connectionString: config.migrationDatabaseUrl });
    await client.connect();
    const before = (await client.query(`SELECT id FROM tenants WHERE slug = 'demo'`)).rows[0];
    const t = await seedBaseTenant(client, { name: 'Demo MICE Acenta', slug: 'demo', emailDomain: 'demo.test' });
    if (!before) await seedChannelPrices(client, t.tenantId, t.suppliers, '2027-03-12', 2);
    if (!before) await seedChannelPrices(client, t.tenantId, t.suppliers, '2027-04-20', 2);
    await client.end();
    initPool(config.databaseUrl);
    registerAll();
    const deps: AppDeps = { config, ai: createAiService(process.env), email: new OutboxEmailProvider(), now: () => new Date(), rng: Math.random };
    if (!before) await seedDemoProjects(deps, t);
    console.log(before ? 'demo tenant already exists (use --reset to recreate)' : 'demo tenant seeded');
    console.log('logins: admin@demo.test / clerk@demo.test / ops@demo.test / field@demo.test / finance@demo.test — password demo1234');
    await closePool();
  })().catch(async (e) => {
    console.error(e);
    await closePool();
    process.exit(1);
  });
}
