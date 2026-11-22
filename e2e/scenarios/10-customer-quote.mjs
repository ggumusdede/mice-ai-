// Senaryo 10 — Müşteri teklif sayfası (§7 Adım 4, §17.2): ekip teklif kartında "Açıldı" görmeden önce yok, müşteri linki açınca
// görür (opened_at) · PO zorunlu müşteri (varsayılan "imzalı onay veya PO") PO girmeden onaylayamaz · "online onay yeterli" müşteri
// yalnız adıyla kabul eder → proje kazanıldı.
import { scenario, step, as, newPage, expect, must, openTab, shot, RUN } from '../lib/harness.mjs';
import { arrangeOffers, createProject, sentQuote } from '../lib/setup.mjs';

await scenario('10-customer-quote', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');

  await step('PO-required customer: "Açıldı" appears after opening; accept needs a PO', async () => {
    const p = await arrangeOffers(boss, await createProject(boss, { customer: `PO Zorunlu ${RUN}` }));
    await sentQuote(boss, p);
    await openTab(boss, p.projectId, 'quote');
    const card = boss.locator('.card', { hasText: /^Rev\.1/ }).first();
    await card.getByText('Gönderildi').first().waitFor();
    expect(!(await card.getByText(/Açıldı:/).count()), 'not opened yet');
    const cust = await newPage('customer-po', true);
    await cust.goto(p.quoteLink);
    await cust.locator('.qopts').waitFor();
    await cust.getByRole('radio', { name: 'Bu seçeneği seç' }).nth(1).click();
    await cust.getByLabel('Adınız soyadınız').fill('Pelin Onay');
    const accept = cust.getByRole('button', { name: 'Teklifi onayla' });
    await cust.getByText('Bu müşteri için PO numarası zorunludur.').waitFor();
    expect(await accept.isDisabled(), 'accept disabled without PO');
    await shot(cust, 'po-required', true);
    await cust.getByLabel('PO numarası').fill(`PO-${RUN}`);
    expect(!(await accept.isDisabled()), 'accept enabled with PO');
    await accept.click();
    await cust.getByText('Onayınız alındı. Teşekkürler!').first().waitFor();
    await cust.context().close();
    await openTab(boss, p.projectId, 'quote');
    await card.getByText(/Açıldı:/).waitFor();
    await card.getByText('Kabul edilen seçenek: 2').waitFor();
    const q = await must(boss, 'GET', `/quotes/${p.quoteId}`);
    expect(q.status === 'accepted' && q.acceptedOptionNo === 2, `accepted option 2 (${q.status})`);
    // note: the PO number / approver name are stored (quotes.po_number) but not part of the Quote contract → not visible to the team
    await shot(boss, 'team-quote-opened', true);
  });

  await step('Online-approval customer accepts with the name only → won', async () => {
    const cust0 = await must(boss, 'POST', '/customers', {
      name: `Online Onay ${RUN}`, shortCode: `ONL${RUN}`.slice(0, 10), contacts: [{ name: 'Okan Online', email: `okan-${RUN.toLowerCase()}@online.example` }],
      rules: { firmApproval: 'online', depositRate: 0, omitPaymentCancellationClauses: false, specialClauses: [], preferredLanguage: 'tr', preferredCurrency: 'EUR' },
    });
    const p = await arrangeOffers(boss, await createProject(boss, { customer: `Online Onay ${RUN}` }));
    await must(boss, 'PATCH', `/projects/${p.projectId}`, { customerId: cust0.id });
    await sentQuote(boss, p);
    const cust = await newPage('customer-online', true);
    await cust.goto(p.quoteLink);
    await cust.locator('.qopts').waitFor();
    expect(!(await cust.getByLabel('PO numarası').count()), 'no PO field for online-approval customers');
    await cust.getByRole('radio', { name: 'Bu seçeneği seç' }).first().click();
    await cust.getByLabel('Adınız soyadınız').fill('Okan Online');
    await cust.getByRole('button', { name: 'Teklifi onayla' }).click();
    await cust.getByText('Onayınız alındı. Teşekkürler!').first().waitFor();
    await shot(cust, 'online-accepted', true);
    await cust.context().close();
    const d = await must(boss, 'GET', `/projects/${p.projectId}`);
    expect(d.project.outcome === 'won', `won on online approval (${d.project.outcome})`);
    await openTab(boss, p.projectId, 'quote');
    await boss.locator('.card', { hasText: /^Rev\.1/ }).getByText(/Açıldı:/).waitFor();
  });
});
