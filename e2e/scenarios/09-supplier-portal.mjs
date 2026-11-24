// Senaryo 9 — Tedarikçi portalı uç durumları (§10, §17.5): geçersiz link sayfası · teklif + ek dosya (CSV) yükleme · son tarihe
// kadar revizyon = yeni sürüm (v1 silinmez, ekip Teklifler sekmesinde v2'yi görür) · son tarih geçince form salt okunur ·
// proje kaybedilince link kapanır ("süresi doldu").
import { scenario, step, as, newPage, expect, must, openTab, shot, BASE, RUN, sql, notes, allowHttp } from '../lib/harness.mjs';
import { createProject, rfqLinks, suppliers } from '../lib/setup.mjs';

await scenario('09-supplier', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');
  const p = await createProject(boss, { customer: `Portal Test ${RUN}` });
  const sup = await suppliers(boss);
  const names = ['Moda Sahil Otel', 'Kalamış Marina Hotel'];
  const third = Object.values(sup).find((s) => s.status === 'accredited' && s.kinds.includes('accommodation') && !names.includes(s.name));
  const ids = [sup[names[0]].id, sup[names[1]].id, third.id];
  await must(boss, 'POST', `/items/${p.acc}/rfqs`, { supplierIds: ids, deadlineHours: 48 });
  const links = await rfqLinks(boss, p.projectId, p.acc);
  const link = (id) => links.find((l) => l.supplierId === id);
  expect(links.length === 3, `3 supplier links (${links.length})`);
  allowHttp(/\/public\/rfq\//, 404);
  allowHttp(/\/public\/rfq\//, 410);

  await step('Unknown / broken link → "geçersiz veya süresi dolmuş" page', async () => {
    const s = await newPage('supplier-x', true);
    await s.goto(`${BASE}/s/rfq/bu-link-yok-${RUN}`);
    await s.getByText(/geçersiz|süresi dol/i).first().waitFor();
    await shot(s, 'invalid-link');
    await s.context().close();
  });

  await step('Supplier submits v1 with an attachment, then revises → v2 (v1 kept)', async () => {
    const s = await newPage('supplier-a', true);
    await s.goto(link(ids[0]).url);
    const row = s.locator('.lines__row').nth(0);
    await row.getByLabel('Açıklama', { exact: true }).fill('Oda, oda+kahvaltı');
    await row.getByLabel('Adet', { exact: true }).fill('40');
    await row.getByLabel(/Birim fiyat/).fill('110');
    await s.getByRole('button', { name: 'Teklifi gönder' }).click();
    await s.getByText('Teklifiniz alındı (sürüm 1). Teşekkürler!').waitFor();
    const csv = Buffer.from('Açıklama;Adet;Birim fiyat;Para birimi\nOda (SGL, BB);20;99;EUR\nOda (DBL, BB);20;109;EUR\n', 'utf8');
    const picker = s.locator('.file-picker').first();
    await picker.locator('input[type=file]').setInputFiles({ name: `fiyat-listesi-${RUN}.csv`, mimeType: 'text/csv', buffer: csv });
    await s.getByText(`fiyat-listesi-${RUN}.csv`).first().waitFor({ timeout: 30_000 });
    await s.reload();
    await s.getByRole('heading', { name: 'Önceki sürümler' }).waitFor();
    const revised = s.locator('.lines__row').nth(0);
    await revised.getByLabel(/Birim fiyat/).fill('101');
    await s.getByRole('button', { name: 'Teklifi gönder' }).click();
    await s.getByText(/Teklifiniz alındı \(sürüm [23]\)/).waitFor();
    await shot(s, 'revised', true);
    await s.context().close();
    const item = (await must(boss, 'GET', `/projects/${p.projectId}`)).items.find((i) => i.id === p.acc);
    const mine = item.offers.filter((o) => o.supplierId === ids[0]);
    expect(mine.length >= 2 && mine.filter((o) => !o.supersededBy).length === 1, `older versions kept, one current (${mine.map((o) => `v${o.version}${o.supersededBy ? '*' : ''}`)})`);
    const current = mine.find((o) => !o.supersededBy);
    await openTab(boss, p.projectId, 'offers');
    const card = boss.locator('section.card', { has: boss.locator('.card__title', { hasText: /^Konaklama/ }) }).first();
    await card.locator('tr', { hasText: names[0] }).getByText(`v${current.version}`).waitFor();
    await card.getByText(/Önceki sürümler/).click();
    await card.getByText(`${names[0]} v1`).waitFor();
    await shot(boss, 'team-offers-v2', true);
  });

  await step('After the deadline the form is read-only', async () => {
    const r = await sql(`UPDATE rfqs SET deadline_at = now() - interval '1 hour' WHERE id = '${link(ids[1]).rfqId}'`);
    if (r === null) {
      notes.push('psql not available — read-only check skipped');
      return;
    }
    const s = await newPage('supplier-b', true);
    await s.goto(link(ids[1]).url);
    await s.getByText('Son tarih geçti — form salt okunur.').waitFor();
    expect(!(await s.getByRole('button', { name: 'Teklifi gönder' }).count()), 'no submit button');
    expect(await s.getByLabel('Opsiyon').isDisabled(), 'inputs disabled');
    await shot(s, 'read-only', true);
    await s.context().close();
  });

  await step('Project lost → supplier link closed', async () => {
    await must(boss, 'POST', `/projects/${p.projectId}/outcome`, { outcome: 'lost', lostReason: 'Müşteri etkinliği iptal etti' });
    const s = await newPage('supplier-c', true);
    await s.goto(link(ids[2]).url);
    await s.getByText(/geçersiz|süresi dol|kapan/i).first().waitFor();
    expect(!(await s.getByRole('button', { name: 'Teklifi gönder' }).count()), 'no form on a closed link');
    await shot(s, 'closed-after-lost');
    await s.context().close();
  });
});
