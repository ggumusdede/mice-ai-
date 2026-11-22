// Senaryo 18 — ürün sahibi kararları Q7 + Q8: kaybedilen projenin açık kararları otomatik kapanır (expired + neden, geçmişte
// görünür); yönetici "Ekip performansı" (390 px kartlar, masaüstü tablo, son 12 ay); müşteri PO numarası proje kodunun yanında
// görünür ve PO ile proje aranır (PO ≠ proje kodu).
import { scenario, step, as, expect, must, openTab, shot, BASE, RUN } from '../lib/harness.mjs';
import { arrangeOffers, createProject, sentQuote, wonProject } from '../lib/setup.mjs';

const REASON = `Bütçe kesildi (${RUN})`;

await scenario('18-owner-decisions', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');

  await step('Q7: lost project → its open decision cards expire with the reason (kept in history)', async () => {
    const p = await arrangeOffers(boss, await createProject(boss, { customer: `Kayıp Karar ${RUN}` }));
    await sentQuote(boss, p);
    const clerk = (await must(boss, 'GET', '/users')).items.find((u) => u.email === 'clerk@demo.test');
    await must(boss, 'POST', `/projects/${p.projectId}/assign`, { userId: clerk.id }); // owner = salesperson in the report
    const open = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}`)).items;
    await must(boss, 'POST', `/projects/${p.projectId}/outcome`, { outcome: 'lost', lostReason: REASON });
    expect(!(await must(boss, 'GET', `/decisions?projectId=${p.projectId}`)).items.length, 'no open cards left on the lost project');
    const expired = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}&status=expired`)).items.map((d) => d.id);
    expect(open.every((d) => expired.includes(d.id)), `previously open cards listed as expired (${open.length})`);
  });

  await step('Q8: PO number next to the project code; searchable by PO', async () => {
    const p = await wonProject(boss, { customer: `PO Test ${RUN}` });
    expect(p.code !== `PO-${RUN}`, 'PO number differs from the project code');
    await openTab(boss, p.projectId, 'quote');
    await boss.locator('.project__code').getByText(`PO-${RUN}`).waitFor();
    await boss.locator('.card', { hasText: /^Rev\.1/ }).getByText(`PO-${RUN}`).waitFor();
    await boss.goto(`${BASE}/projeler?q=${encodeURIComponent(`PO-${RUN}`)}`);
    await boss.locator('table a', { hasText: p.code }).waitFor();
    await shot(boss, 'project-po-number', true);
  });

  await step('Q7: "Ekip performansı" — table on desktop, cards at 390 px; lost reason listed', async () => {
    await boss.goto(`${BASE}/yonetim/ekip-performansi`);
    await boss.locator('.tp__table table').waitFor();
    expect(await boss.locator('.tp__cards').isHidden(), 'cards hidden on desktop');
    await boss.getByText('Kaybedilen projeler ve nedenleri').waitFor();
    const mobile = await as('admin@demo.test', 'admin-mobile', true);
    await mobile.goto(`${BASE}/yonetim/ekip-performansi`);
    await mobile.locator('.tp__card').first().waitFor();
    expect(await mobile.locator('.tp__table').isHidden(), 'table hidden at 390 px');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 1, `no horizontal scroll at 390 px (${overflow})`);
    await mobile.locator('.tp details summary').first().click();
    await mobile.getByText(REASON).first().waitFor();
    await mobile.getByLabel('Dönem').selectOption('3m');
    await mobile.locator('.tp__card').first().waitFor();
    await shot(mobile, 'team-performance-mobile', true);
  });
});
