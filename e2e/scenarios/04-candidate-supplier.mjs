// Senaryo 4 — Aday tedarikçi (§7 Adım 1, §17.1): satış "Yeni aday tedarikçi" ekler → kısa listede "Aday" → RFQ alır ve
// /s/rfq/<token> üzerinden teklif verir → teklif oluşturucu aday teklifini "Aday tedarikçi" ile işaretler ve teklifi bloklar →
// akreditasyon talebi → yönetici karar kutusundan "Akredite et" → aynı teklif bloklanmadan geçer.
import { scenario, step, as, newPage, expect, must, openTab, shot, BASE, RUN, adminDecide } from '../lib/harness.mjs';
import { addOffer, accLines, createProject, rfqLinks, suppliers } from '../lib/setup.mjs';

const NAME = `Aday Butik Otel ${RUN}`;

await scenario('04-candidate', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await createProject(boss, { customer: `Aday Test ${RUN}` });
  await must(boss, 'PATCH', `/items/${p.hall}`, { status: 'cancelled' });
  const team = await as('ops@demo.test', 'ops-desktop');
  let candidateId = '';

  await step('Ops adds a candidate supplier from the item card and sends it an RFQ', async () => {
    await openTab(team, p.projectId, 'items');
    const acc = team.locator('section.card', { has: team.locator('.card__title', { hasText: /^Konaklama/ }) }).first();
    await acc.getByRole('button', { name: 'Yeni aday tedarikçi' }).first().click();
    const form = acc.locator('form.subcard');
    await form.getByLabel('Ad').fill(NAME);
    await form.getByLabel('Şehir').fill('İstanbul');
    await form.getByLabel('Semt').fill('Kadıköy');
    await form.getByLabel('E-posta').fill(`satis-${RUN.toLowerCase()}@aday-otel.example`);
    await form.getByRole('button', { name: 'Ekle' }).click();
    await team.locator('.toast', { hasText: `${NAME} — Aday` }).waitFor();
    candidateId = (await must(team, 'GET', '/suppliers?status=candidate')).items.find((s) => s.name === NAME)?.id ?? '';
    expect(candidateId, 'candidate supplier created with status candidate');
    await acc.getByRole('button', { name: 'Kısa listeyi getir' }).click();
    const row = acc.locator('.list__row', { hasText: NAME });
    await row.locator('.pill', { hasText: 'Aday' }).waitFor();
    await row.locator('input[type=checkbox]').check();
    await shot(team, 'shortlist-with-candidate', true);
    await acc.getByRole('button', { name: 'RFQ taslaklarını oluştur' }).click();
    await acc.getByRole('cell', { name: 'Onay bekliyor' }).first().waitFor();
  });

  await step('Candidate submits an offer on the supplier page', async () => {
    const link = (await rfqLinks(boss, p.projectId, p.acc)).find((l) => l.supplierId === candidateId);
    expect(link?.url, 'RFQ link for the candidate');
    const sup = await newPage('candidate-supplier', true);
    await sup.goto(link.url);
    const row1 = sup.locator('.lines__row').nth(0);
    await row1.getByLabel('Açıklama', { exact: true }).fill('SGL+DBL oda, oda+kahvaltı');
    await row1.getByLabel('Adet', { exact: true }).fill('40');
    await row1.getByLabel(/Birim fiyat/).fill('80');
    await sup.getByLabel('Opsiyon').fill('2027-01-20');
    await sup.getByRole('button', { name: 'Teklifi gönder' }).click();
    await sup.getByText(/Teklifiniz alındı \(sürüm 1\)/).first().waitFor();
    await sup.context().close();
    // a second (accredited) offer so the builder has two options
    await addOffer(boss, p.acc, (await suppliers(boss))['Moda Sahil Otel'].id, accLines(95, 110));
  });

  const build = async (expectBlocked) => {
    await openTab(team, p.projectId, 'quote');
    const builder = team.locator('.card', { hasText: 'Teklif oluşturucu' }).first();
    await builder.locator('.qb__opt').nth(1).waitFor();
    const sel = builder.locator('.qb__opt').nth(0).locator('select').first();
    const opt = (await sel.locator('option').allInnerTexts()).find((o) => o.includes(NAME));
    expect(opt, 'candidate offer selectable');
    await sel.selectOption({ label: opt });
    if (expectBlocked) await builder.locator('.qb__opt').nth(0).getByText('Aday tedarikçi').waitFor();
    for (const input of await builder.locator('.inline-field--num input').all()) await input.fill('25');
    const [resp] = await Promise.all([
      team.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${p.projectId}/quotes`)),
      builder.getByRole('button', { name: 'Teklifi doğrula' }).click(),
    ]);
    const q = await resp.json();
    await builder.locator('.callout').first().waitFor();
    return q;
  };

  await step('Quote builder flags and blocks the candidate offer', async () => {
    const q = await build(true);
    expect(q.status === 'blocked' && q.blockReasons.some((r) => /aday|akredit/i.test(r)), `blocked for the candidate (${q.status} ${JSON.stringify(q.blockReasons)})`);
    await team.locator('.card', { hasText: 'Teklif oluşturucu' }).getByText('Bloklanma nedenleri').waitFor();
    await shot(team, 'quote-blocked-candidate', true);
  });

  await step('Accreditation requested from the blocked quote ("Akreditasyon iste", Q6) → admin accredits from the inbox (mobile)', async () => {
    const builder = team.locator('.card', { hasText: 'Teklif oluşturucu' }).first();
    await builder.locator('.callout').getByRole('button', { name: `Akreditasyon iste: ${NAME}` }).click();
    await team.locator('.toast', { hasText: 'karar kutusuna' }).waitFor();
    // idempotent: a second request reuses the open card
    const again = await must(team, 'POST', `/suppliers/${candidateId}/request-accreditation`, {});
    expect(again.created === false, 'open accreditation card reused');
    const cards = (await must(boss, 'GET', '/decisions')).items.filter((d) => d.kind === 'supplier_accreditation' && d.entityId === candidateId);
    expect(cards.length === 1 && cards[0].requiredRole === 'admin', 'one admin-only accreditation card');
    const admin = await as('admin@demo.test', 'admin-mobile', true);
    await adminDecide(admin, `${NAME} akredite edilsin mi?`, { shotName: 'inbox-accreditation' });
    const s = (await must(boss, 'GET', `/suppliers/${candidateId}`));
    expect((s.status ?? s.supplier?.status) === 'accredited', 'supplier accredited');
  });

  await step('Same quote now passes', async () => {
    const q = await build(false);
    expect(['pending_approval', 'approved'].includes(q.status), `quote passes after accreditation (${q.status} ${JSON.stringify(q.blockReasons)})`);
    await shot(team, 'quote-after-accreditation', true);
  });
});
