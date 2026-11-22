// Senaryo 1 — Revizyon döngüsü (§7 Adım 4): müşteri /q/<token> üzerinden kişi sayısı değişikliği ister → proje UI'da Adım 1'e
// (Tedarikçi seçimi ve RFQ) döner, v1 "Revizyon istendi" → ekip kişi sayısını günceller, teklif oluşturucuda v2 → yönetici onayı
// (karar kutusu, dev biyometrik) → gönderim → müşteri v2'yi kabul eder; eski v1 linki artık geçersiz.
import { scenario, step, as, newPage, expect, must, openTab, adminDecide, shot, BASE } from '../lib/harness.mjs';
import { arrangeOffers, createProject, sentQuote } from '../lib/setup.mjs';

await scenario('01-revision', async () => {
  const admin = await as('admin@demo.test', 'admin-mobile', true);
  const p = await arrangeOffers(admin, await createProject(admin, { customer: 'Revizyon Lojistik', pax: 60 }));
  await sentQuote(admin, p);
  const clerk = await as('admin@demo.test', 'team-desktop');

  await step('Customer asks for a revision (pax 60 → 80) on /q/<token>', async () => {
    const cust = await newPage('customer', true);
    await cust.goto(p.quoteLink);
    await cust.locator('.qopts').waitFor();
    await cust.getByRole('button', { name: 'Revizyon iste' }).click();
    await cust.getByLabel('Revizyon talebiniz').fill('Merhaba, katılımcı sayımız arttı: 80 kişi olacağız. Diğer her şey aynı kalabilir.');
    await shot(cust, 'customer-revision-form', true);
    await cust.locator('section').getByRole('button', { name: 'Revizyon iste' }).click();
    await cust.getByText('Revizyon talebiniz iletildi.').waitFor();
    await cust.context().close();
  });

  await step('Team sees the project back at step 1 (RFQ) and v1 "Revizyon istendi"', async () => {
    await openTab(clerk, p.projectId, 'quote');
    const current = clerk.locator('.steps__item[aria-current="step"]');
    expect((await current.innerText()).includes('Tedarikçi seçimi ve RFQ'), `current step is 1 (${await current.innerText()})`);
    await clerk.locator('.card', { hasText: /^Rev\.1/ }).getByText('Revizyon istendi').waitFor();
    const tasks = (await must(clerk, 'GET', '/tasks?status=open')).items.filter((t) => t.projectId === p.projectId && t.kind === 'quote_revision');
    expect(tasks.length === 1 && /Kişi sayısı/.test(tasks[0].title), `revision task lists the pax change (${tasks.map((t) => t.title)})`);
    await shot(clerk, 'project-back-to-rfq', true);
  });

  let link2 = '';
  await step('Pax updated → quote v2 built in the UI → admin approves → sent', async () => {
    await must(clerk, 'PATCH', `/projects/${p.projectId}`, { pax: 80, reason: 'Müşteri revizyonu: 80 kişi' });
    await openTab(clerk, p.projectId, 'quote');
    const builder = clerk.locator('.card', { hasText: 'Teklif oluşturucu' }).first();
    await builder.locator('.qb__opt').nth(1).waitFor();
    for (const input of await builder.locator('.inline-field--num input').all()) await input.fill('22');
    const [resp] = await Promise.all([
      clerk.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${p.projectId}/quotes`)),
      builder.getByRole('button', { name: 'Teklifi doğrula' }).click(),
    ]);
    const q2 = await resp.json();
    expect(q2.version === 2, `new quote version v2 (got v${q2.version})`);
    if (q2.status === 'pending_approval') await adminDecide(admin, new RegExp(`${p.code.split('-').slice(0, 2).join('-')}.* v2:`), { shotName: 'inbox-quote-v2' });
    await openTab(clerk, p.projectId, 'quote');
    await clerk.locator('.card', { hasText: /^Rev\.1/ }).getByText('Yenisi var').waitFor();
    const v2 = clerk.locator('.card', { hasText: /^Rev\.2/ }).first();
    await v2.getByRole('button', { name: 'Müşteriye gönder' }).click();
    link2 = await v2.locator('.copy-link__url').innerText({ timeout: 20_000 });
    expect(/\/q\/[\w-]+$/.test(link2) && link2 !== p.quoteLink, 'new approval link for v2');
    await shot(clerk, 'project-quote-v2-sent', true);
  });

  await step('Old v1 link is closed; customer accepts v2 (PO) → project won', async () => {
    const cust = await newPage('customer-v2', true);
    await cust.goto(p.quoteLink);
    await cust.getByText(/geçersiz|yeni bir sürümü/i).first().waitFor();
    await cust.goto(link2);
    await cust.locator('.qopts').waitFor();
    await cust.getByRole('radio', { name: 'Bu seçeneği seç' }).first().click();
    await cust.getByLabel('Adınız soyadınız').fill('Rana Revizyon');
    const po = cust.getByLabel('PO numarası');
    if (await po.count()) await po.fill('PO-REV-2');
    await cust.getByRole('button', { name: 'Teklifi onayla' }).click();
    await cust.getByText('Onayınız alındı. Teşekkürler!').first().waitFor();
    await cust.context().close();
    await openTab(clerk, p.projectId, 'quote');
    await clerk.locator('.card', { hasText: /^Rev\.2/ }).getByText('Kabul edildi').waitFor();
    await clerk.locator('.project__meta').getByText('Kazanıldı').waitFor();
    await shot(clerk, 'project-quote-v2-accepted', true);
    void BASE;
  });
});
