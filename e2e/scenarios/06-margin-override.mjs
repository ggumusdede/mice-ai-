// Senaryo 6 — Marj istisnası (§7 Adım 3, §9): hedef marjın altındaki teklif bloklanır → karar kutusunda "Marj istisnası";
// alt panelde gerekçe yazılmadan birincil eylem pasif → yönetici gerekçeyi yazar, (dev) biyometrikle onaylar → teklif "Onaylandı",
// gerekçe kayıtlı.
import { scenario, step, as, expect, must, openTab, shot, openDecision, approveInSheet, closedSheet } from '../lib/harness.mjs';
import { arrangeOffers, createProject } from '../lib/setup.mjs';

const REASON = 'Yeni stratejik müşteri — ilk etkinlikte düşük marj kabul, yıllık 4 etkinlik potansiyeli';

await scenario('06-margin', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await arrangeOffers(boss, await createProject(boss, { customer: 'Marj Testi A.Ş.' }));
  const team = await as('ops@demo.test', 'ops-desktop');
  let quote;

  await step('Team builds a quote with 3 % markup → blocked below target margin', async () => {
    await openTab(team, p.projectId, 'quote');
    const builder = team.locator('.card', { hasText: 'Teklif oluşturucu' }).first();
    await builder.locator('.qb__opt').nth(1).waitFor();
    for (const input of await builder.locator('.inline-field--num input').all()) await input.fill('3');
    await builder.locator('.qb__totals .text-danger').first().waitFor(); // client pre-check shows the margin in red
    const [resp] = await Promise.all([
      team.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${p.projectId}/quotes`)),
      builder.getByRole('button', { name: 'Teklifi doğrula' }).click(),
    ]);
    quote = await resp.json();
    expect(quote.status === 'blocked', `blocked (${quote.status})`);
    await builder.getByText('Bloklanma nedenleri').waitFor();
    await shot(team, 'quote-below-target', true);
  });

  await step('Admin must write a reason in the bottom sheet, then approves', async () => {
    const admin = await as('admin@demo.test', 'admin-mobile', true);
    const { sheet, summary } = await openDecision(admin, new RegExp(`${p.code.split('-').slice(0, 2).join('-')}.*hedef marj altı`));
    expect(summary.includes(`v${quote.version}`), `card for v${quote.version}`);
    const primary = sheet.locator('.sheet-actions > button').first();
    expect(await primary.isDisabled(), 'primary action disabled without a reason');
    const dev = sheet.getByRole('button', { name: 'Geliştirici doğrulaması ile onayla' });
    if (await dev.count()) expect(await dev.isDisabled(), 'dev fallback disabled without a reason');
    await sheet.locator('#approve-reason').fill(REASON);
    expect(!(await primary.isDisabled()), 'enabled with a reason');
    await shot(admin, 'margin-sheet-reason');
    await approveInSheet(sheet);
    await closedSheet(sheet, summary);
    await admin.locator('.toast', { hasText: /Marj istisnası uygulandı/ }).waitFor();
  });

  await step('Quote approved with the override reason recorded', async () => {
    const q = await must(boss, 'GET', `/quotes/${quote.id}`);
    expect(q.status === 'approved', `approved (${q.status})`);
    expect(JSON.stringify(q).includes(REASON), 'override reason stored on the quote');
    await openTab(team, p.projectId, 'quote');
    await team.locator('.card', { hasText: new RegExp(`^v${quote.version}`) }).getByText('Onaylandı').waitFor();
    await shot(team, 'quote-override-approved', true);
  });
});
