// Senaryo 7 — Yöneticinin mobil günü (390×844, §15): karar kutusunda farklı kart türleri (teklif, ödeme, akreditasyon, saha ekstrası,
// pazarlık mesajı) → onay / "Düzelt" (taslak düzeltilir, saklanan metin düzeltilmiş metindir) / ret (gerekçe zorunlu) → kalan kartlar
// bitince "Her şey yolunda".
import { scenario, step, as, expect, must, shot, BASE, RUN, TODAY, TOMORROW, openDecision, approveInSheet, closedSheet, adminDecide, http } from '../lib/harness.mjs';
import { arrangeOffers, createProject, quoteBody, signedProject } from '../lib/setup.mjs';

const EDITED = `Merhaba, ${RUN} referanslı toplantımız için oda fiyatında %8 indirim rica ediyoruz; 3 ay içinde ikinci etkinlik planlıyoruz. (Yönetici düzeltmesi)`;

await scenario('07-admin-day', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const ops = await as('ops@demo.test', 'ops-api');
  const fin = await as('finance@demo.test', 'finance-api');
  const fieldU = await as('field@demo.test', 'field-api', true);
  const pfx = (code) => code.split('-').slice(0, 2).join('-');

  // --- preconditions (API): one card of each kind
  const q = await arrangeOffers(boss, await createProject(boss, { customer: `Mobil Gün Teklif ${RUN}` }));
  const quote = await must(ops, 'POST', `/projects/${q.projectId}/quotes`, quoteBody(q, 0.25));
  expect(quote.status === 'pending_approval', `ops quote needs approval (${quote.status})`);
  const neg = await must(ops, 'POST', `/offers/${q.oB}/negotiate`, { arguments: ['volume', 'relationship'] });
  void neg;
  const s = await signedProject(boss, { customer: `Mobil Gün Ödeme ${RUN}` });
  const payable = (await must(fin, 'GET', `/finance/entries?projectId=${s.projectId}`)).items.filter((e) => e.kind === 'payable' && e.supplierId === s.moda).reduce((a, e) => a + e.amount, 0);
  const inv = await must(fin, 'POST', '/finance/supplier-invoices', { projectId: s.projectId, supplierId: s.moda, invoiceNo: `MG-${RUN}`, amount: Math.round(payable * 100) / 100, currency: 'EUR', issueDate: TODAY, serviceItemIds: [s.acc, s.hall] });
  await must(fin, 'POST', '/finance/payment-requests', { entryId: inv.entry.id });
  await must(boss, 'PATCH', `/projects/${s.projectId}`, { startDate: TODAY, endDate: TOMORROW });
  s.code = (await must(boss, 'GET', `/projects/${s.projectId}`)).project.code;
  const extra = await must(fieldU, 'POST', `/projects/${s.projectId}/field-extras`, { description: 'Ek teknik ekipman (mobil gün)', amountTry: 7200 });
  const tok = extra.approvalLink.split('/e/')[1];
  expect((await http('POST', `/public/extras/${tok}/approve`, { body: { approverName: 'Müşteri Temsilcisi' } })).status === 200, 'customer approved the extra');
  const supName = `Mobil Aday Otel ${RUN}`;
  const cand = await must(ops, 'POST', '/suppliers', { name: supName, city: 'İstanbul', kinds: ['accommodation'] });
  await must(ops, 'PATCH', `/suppliers/${cand.id}`, { status: 'accredited' });

  const admin = await as('admin@demo.test', 'admin-mobile', true);
  await step('Inbox shows the card kinds with badges and one-line summaries', async () => {
    await admin.goto(`${BASE}/`);
    await admin.locator('.dcard:not(.dcard--skeleton)').first().waitFor();
    const kinds = await admin.locator('.dcard__kind').allTextContents();
    for (const k of ['Teklif onayı', 'Ödeme onayı', 'Tedarikçi akreditasyonu', 'Saha ekstra', 'Pazarlık mesajı']) expect(kinds.includes(k), `card kind "${k}" present (${[...new Set(kinds)].join(', ')})`);
    const noScroll = await admin.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
    expect(noScroll, 'no horizontal scroll on the inbox');
    await shot(admin, 'inbox-many-cards');
    await shot(admin, 'inbox-many-cards-full', true);
  });

  await step('"Düzelt" on the negotiation draft: the edited text is what gets stored', async () => {
    const { sheet, summary } = await openDecision(admin, new RegExp(`${pfx(q.code)}.*`), { shotName: undefined });
    void summary;
    // the first matching card may be the quote; open the negotiation card explicitly
    await sheet.getByRole('button', { name: 'Kapat' }).click();
    await sheet.waitFor({ state: 'detached' });
    const card = admin.locator('.dcard', { has: admin.locator('.dcard__kind', { hasText: 'Pazarlık mesajı' }) }).filter({ hasText: pfx(q.code) }).first();
    await card.click();
    const sh = admin.getByRole('dialog');
    await sh.getByRole('button', { name: 'Düzelt' }).click();
    await sh.getByText('Taslağı düzelt').waitFor();
    const body = sh.locator('textarea').first();
    await body.fill(EDITED);
    await shot(admin, 'sheet-edit-draft');
    const send = sh.getByRole('button', { name: 'Düzeltilmiş hâliyle onayla' });
    await send.click();
    const dev = sh.getByRole('button', { name: 'Geliştirici doğrulaması ile onayla' });
    if (await dev.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await dev.click();
    await closedSheet(sh, 'negotiation');
    const drafts = (await must(boss, 'GET', `/drafts?projectId=${q.projectId}`)).items.filter((d) => d.kind === 'negotiation');
    expect(drafts.some((d) => d.body === EDITED), `stored draft body is the edited text (${drafts.map((d) => d.body.slice(0, 60)).join(' | ')})`);
  });

  await step('Reject the accreditation with a reason (required)', async () => {
    const { sheet, summary } = await openDecision(admin, `${supName} akredite edilsin mi?`);
    await sheet.getByRole('button', { name: 'Reddet' }).click();
    const primary = sheet.locator('.sheet-actions > button').first();
    expect(await primary.isDisabled(), 'reject disabled without a reason');
    await sheet.getByLabel('Ret gerekçesi').fill('Referans yok; önce site ziyareti yapılsın');
    await primary.click();
    await closedSheet(sheet, summary);
    const sup = await must(boss, 'GET', `/suppliers/${cand.id}`);
    expect((sup.status ?? sup.supplier?.status) === 'candidate', 'still a candidate after rejection');
  });

  await step('Approve quote, payment (Face ID / dev) and field extra', async () => {
    await adminDecide(admin, new RegExp(`${pfx(q.code)}.* v\\d+:`), { shotName: 'sheet-quote' });
    await adminDecide(admin, new RegExp(`${pfx(s.code)}.*: ödeme onayı`), { shotName: 'sheet-payment' });
    await adminDecide(admin, new RegExp(`${pfx(s.code)}.*: saha ekstrası`), { shotName: 'sheet-field-extra' });
    expect((await must(boss, 'GET', `/quotes/${quote.id}`)).status === 'approved', 'quote approved');
    expect((await must(fin, 'GET', `/finance/entries?projectId=${s.projectId}`)).items.some((e) => e.id === inv.entry.id && e.status === 'approved'), 'payment approved');
  });

  await step('Clear the rest → "Her şey yolunda"', async () => {
    for (let i = 0; i < 40; i++) {
      await admin.goto(`${BASE}/`);
      await admin.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
      if (await admin.locator('.allgood').count()) break;
      await adminDecide(admin, '');
    }
    await admin.locator('.allgood', { hasText: 'Her şey yolunda' }).waitFor();
    await shot(admin, 'inbox-all-good');
  });
});
