// Senaryo 11 — Rol bazlı arayüz (§4, §17.1, [Ürün kararı] fieldRoleCanSeeFinancials): satış yönetim / kurallar menüsünü görmez,
// /yonetim/kurallar'da "yalnızca yönetici" uyarısı + salt okunur, kural yazamaz · finans Finans sayfasını görür ama ödeme onaylayamaz ·
// saha kullanıcısı varsayılan kuralla finansal veri görmez → yönetici Kurallar ekranında anahtarı açar → saha kullanıcısı kârı görür.
import { scenario, step, as, expect, must, apiAs, openTab, shot, BASE, RUN, allowHttp } from '../lib/harness.mjs';
import { signedProject } from '../lib/setup.mjs';

let restore = null;
await scenario('11-roles', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');
  const before = await must(boss, 'GET', '/rules');
  if (before.fieldRoleCanSeeFinancials) await must(boss, 'PATCH', '/rules', { fieldRoleCanSeeFinancials: false, reason: 'e2e: varsayılan' });
  restore = async () => must(boss, 'PATCH', '/rules', { fieldRoleCanSeeFinancials: false, reason: 'e2e: geri al' });
  const p = await signedProject(boss, { customer: `Rol Test ${RUN}` });
  const fin = await as('finance@demo.test', 'finance-desktop');
  const payable = (await must(fin, 'GET', `/finance/entries?projectId=${p.projectId}`)).items.filter((e) => e.kind === 'payable' && e.supplierId === p.moda).reduce((a, e) => a + e.amount, 0);
  const inv = await must(fin, 'POST', '/finance/supplier-invoices', { projectId: p.projectId, supplierId: p.moda, invoiceNo: `RL-${RUN}`, amount: Math.round(payable * 100) / 100, currency: 'EUR', issueDate: new Date().toISOString().slice(0, 10) });
  await must(fin, 'POST', '/finance/payment-requests', { entryId: inv.entry.id });

  await step('Sales clerk: no admin / finance / report navigation; rules read-only, PATCH refused', async () => {
    const clerk = await as('clerk@demo.test', 'clerk');
    const nav = clerk.locator('aside.sidebar nav');
    await nav.getByRole('link', { name: 'Projeler' }).waitFor();
    for (const n of ['Yönetim', 'Finans', 'Rapor']) expect(!(await nav.getByRole('link', { name: n }).count()), `no "${n}" link for sales`);
    await clerk.goto(`${BASE}/yonetim/kurallar`);
    await clerk.getByText('Bu bölüm yalnızca yönetici içindir.').waitFor();
    await clerk.locator('#tier-m-0').waitFor();
    expect(await clerk.locator('#tier-m-0').isDisabled(), 'markup tier input disabled');
    expect(!(await clerk.getByRole('button', { name: 'Kaydet' }).count()), 'no save button');
    allowHttp(/\/api\/rules$/, 403, 'PATCH');
    const r = await apiAs(clerk, 'PATCH', '/rules', { targetMarginMin: 0.01 });
    expect(r.status === 403, `rules PATCH refused for sales (${r.status})`);
    await clerk.goto(`${BASE}/finans`);
    await clerk.getByText('Bu bölüm yalnızca yönetici içindir.').waitFor();
    await shot(clerk, 'clerk-rules-readonly', true);
    await clerk.context().close();
  });

  await step('Finance: Finans page yes, payment approval no', async () => {
    await fin.goto(`${BASE}/finans`);
    await fin.getByRole('heading', { name: 'Finans', exact: true }).waitFor();
    await fin.goto(`${BASE}/`);
    await fin.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
    expect(!(await fin.locator('.dcard', { hasText: 'ödeme onayı' }).count()), 'no payment approval cards for finance');
    const d = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}&status=open`)).items.find((x) => x.kind === 'payment_approval');
    expect(d, 'payment approval decision open');
    allowHttp(/\/decisions\/[^/]+\/decide$/, 403, 'POST');
    const r = await apiAs(fin, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
    expect(r.status === 403, `finance cannot approve payments (${r.status})`);
    await shot(fin, 'finance-inbox');
  });

  const field = await as('field@demo.test', 'field', true);
  await step('Field user: no financial data by default', async () => {
    await openTab(field, p.projectId);
    expect(!(await field.locator('.tabs__tab', { hasText: 'Finans' }).count()), 'no Finans tab');
    expect(!(await field.getByText('Beklenen kâr').count()), 'no profit block');
    await shot(field, 'field-no-financials', true);
  });

  await step('Admin flips "Saha rolü finansal verileri görebilir" in the Rules UI → field user sees profit', async () => {
    await boss.goto(`${BASE}/yonetim/kurallar`);
    const toggle = boss.locator('label', { hasText: 'Saha rolü finansal verileri görebilir' }).locator('input[type=checkbox]');
    expect(!(await toggle.isChecked()), 'default off');
    await toggle.check();
    await boss.getByRole('button', { name: 'Kaydet' }).click();
    await boss.locator('.toast', { hasText: 'Kurallar kaydedildi' }).waitFor();
    await shot(boss, 'rules-field-toggle');
    await openTab(field, p.projectId);
    await field.getByText('Beklenen kâr').waitFor();
    await field.locator('.tabs__tab', { hasText: 'Finans' }).waitFor();
    await shot(field, 'field-with-financials', true);
  });
}, { cleanup: async () => restore?.() });
