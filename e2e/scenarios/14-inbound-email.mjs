// Senaryo 14 — Gelen e-posta (§7 Adım 1, docs/07 §6): tedarikçinin RFQ yanıtı imzalı webhook ile gelir
// (POST /api/inbound/email/demo, X-MICE-Timestamp + X-MICE-Signature = sha256 HMAC(secret, "ts.body"), betik içinde hesaplanır) →
// teklif projenin Teklifler sekmesinde (kaynak E-posta) ve Genel bakış'taki "Gelen kutusu" panelinde "Tedarikçi yanıtı" olarak görünür.
// API, INBOUND_EMAIL_SECRET ile başlatılmış olmalı; betik aynı değeri INBOUND_EMAIL_SECRET ortam değişkeninden okur (yoksa SKIP).
import { createHmac } from 'node:crypto';
import { scenario, step, as, expect, must, openTab, shot, RUN, http, skip } from '../lib/harness.mjs';
import { createProject, rfqLinks, suppliers } from '../lib/setup.mjs';

const SECRET = process.env.INBOUND_EMAIL_SECRET;
const TENANT = process.env.INBOUND_EMAIL_TENANT ?? 'demo';

await scenario('14-inbound', async () => {
  if (!SECRET) skip('INBOUND_EMAIL_SECRET is not set (start the api with it and export the same value)');
  const boss = await as('admin@demo.test', 'admin-desktop');
  const p = await createProject(boss, { customer: `Gelen Kutusu ${RUN}` });
  const sup = await suppliers(boss);
  const moda = sup['Moda Sahil Otel'];
  expect(moda.email, 'seeded supplier has an e-mail address');
  const others = Object.values(sup).filter((s) => s.status === 'accredited' && s.kinds.includes('accommodation') && s.id !== moda.id).slice(0, 2);
  await must(boss, 'POST', `/items/${p.acc}/rfqs`, { supplierIds: [moda.id, ...others.map((s) => s.id)] });
  await rfqLinks(boss, p.projectId, p.acc);
  const tag = p.code.split('-').slice(0, 2).join('-');

  await step('Signed inbound webhook with the supplier reply', async () => {
    const body = JSON.stringify({
      from: `Moda Sahil Otel Satış <${moda.email}>`, to: 'teklif@demo.test', subject: `Re: [${tag}] Fiyat talebi — konaklama`,
      messageId: `<e2e-${RUN}@moda-sahil.example>`,
      text: `Merhaba,\n12-13 Mart 2027 için teklifimiz: SGL oda 20 adet x 1 gece 97 EUR, DBL oda 20 adet x 1 gece 112 EUR, kahvaltı dahil, KDV hariç (%10).\nOpsiyon tarihi: 20 Ocak 2027. Ödeme: %30 ön ödeme.\nSaygılarımızla, Moda Sahil Otel`,
    });
    const ts = Math.floor(Date.now() / 1000);
    const bad = await http('POST', `/inbound/email/${TENANT}`, { raw: body, headers: { 'Content-Type': 'application/json', 'X-MICE-Timestamp': String(ts), 'X-MICE-Signature': 'sha256=00' } });
    expect(bad.status === 401, `bad signature refused (${bad.status})`);
    const sig = createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const r = await http('POST', `/inbound/email/${TENANT}`, { raw: body, headers: { 'Content-Type': 'application/json', 'X-MICE-Timestamp': String(ts), 'X-MICE-Signature': `sha256=${sig}` } });
    console.log(`   webhook → ${r.status} ${r.text.slice(0, 200)}`);
    expect(r.status === 200, `signed webhook accepted (${r.status})`);
  });

  await step('Offer appears in the Offers tab (source e-mail) and in "Gelen kutusu"', async () => {
    await openTab(boss, p.projectId, 'offers');
    const card = boss.locator('section.card', { has: boss.locator('.card__title', { hasText: /^Konaklama/ }) }).first();
    const row = card.locator('tr', { hasText: 'Moda Sahil Otel' }).first();
    await row.waitFor();
    await row.getByText('E-posta').waitFor();
    await shot(boss, 'offers-from-email', true);
    await openTab(boss, p.projectId);
    const inbox = boss.locator('.card', { has: boss.locator('.card__title', { hasText: 'Gelen kutusu' }) });
    const msg = inbox.locator('tr', { hasText: 'Moda Sahil Otel' }).first();
    await msg.getByText('Tedarikçi yanıtı').waitFor();
    await msg.getByRole('link', { name: /Teklif v\d+/ }).waitFor();
    await shot(boss, 'overview-inbox-panel', true);
  });
});
