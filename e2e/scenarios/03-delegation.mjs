// Senaryo 3 — Vekâlet (§17.1): yönetici /yonetim/vekalet'te ops kullanıcısına bugün için vekâlet verir → ops karar kutusunda
// ödeme kartını görür, alt panelde "Vekil olarak onaylıyorsunuz", dev biyometrikle onaylar; akreditasyon / kural kartlarını görmez →
// vekâlet sonlandırılınca ikinci ödeme kartı ops'a görünmez ve API kararı reddeder.
import { scenario, step, as, expect, must, apiAs, shot, BASE, RUN, approveInSheet, closedSheet, openDecision, allowHttp } from '../lib/harness.mjs';
import { signedProject, userByEmail } from '../lib/setup.mjs';

async function paymentRequest(fin, p, no) {
  const entries = (await must(fin, 'GET', `/finance/entries?projectId=${p.projectId}`)).items;
  const amount = Math.round(entries.filter((e) => e.kind === 'payable' && e.supplierId === p.moda).reduce((s, e) => s + e.amount, 0) * 50) / 100; // half → two requests
  const inv = await must(fin, 'POST', '/finance/supplier-invoices', {
    projectId: p.projectId, supplierId: p.moda, invoiceNo: `VK-${RUN}-${no}`, amount, currency: 'EUR', vatAmount: Math.round(amount * 10) / 100, issueDate: new Date().toISOString().slice(0, 10), serviceItemIds: [p.acc, p.hall],
  });
  return must(fin, 'POST', '/finance/payment-requests', { entryId: inv.entry.id });
}

let endDelegation = null;
await scenario('03-delegation', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');
  const p = await signedProject(boss, { customer: `Vekalet Turizm ${RUN}` });
  const fin = await as('finance@demo.test', 'finance');
  await paymentRequest(fin, p, 1);
  // an admin-only card (accreditation) and a rule suggestion-like admin card must stay invisible to the delegate
  const cand = await must(boss, 'POST', '/suppliers', { name: `Aday Otel ${RUN}`, city: 'İstanbul', district: 'Kadıköy', kinds: ['accommodation'] });
  await must(boss, 'PATCH', `/suppliers/${cand.id}`, { status: 'accredited', reason: 'e2e vekâlet' });
  const ops = await userByEmail(boss, 'ops@demo.test');

  await step('Admin creates a delegation to the ops user for today (UI)', async () => {
    await boss.goto(`${BASE}/yonetim/vekalet`);
    const form = boss.locator('.card', { hasText: 'Yeni vekâlet' });
    await form.getByLabel('Vekil').selectOption(ops.id);
    const dt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await form.getByLabel('Başlangıç').fill(dt(new Date(Date.now() - 3_600_000)));
    await form.getByLabel('Bitiş').fill(dt(new Date(Date.now() + 8 * 3_600_000)));
    await form.getByRole('button', { name: 'Oluştur' }).click();
    await boss.locator('tbody tr', { hasText: ops.fullName }).filter({ hasText: 'Aktif' }).first().waitFor();
    const d = (await must(boss, 'GET', '/delegations')).items.find((x) => x.delegateId === ops.id && !x.endedAt && new Date(x.endsAt) > new Date());
    endDelegation = async () => { if (d) await apiAs(boss, 'POST', `/delegations/${d.id}/end`); };
    await shot(boss, 'delegation-created', true);
  });

  const opsPage = await as('ops@demo.test', 'ops-mobile', true);
  await step('Delegate sees the payment card ("Vekil olarak onaylıyorsunuz") but no accreditation card; approves', async () => {
    await opsPage.goto(`${BASE}/`);
    await opsPage.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
    const cards = await opsPage.locator('.dcard__summary').allInnerTexts();
    expect(!cards.some((c) => c.includes(`Aday Otel ${RUN}`)), `no accreditation card for the delegate (${cards.join(' | ')})`);
    expect(!(await opsPage.locator('.dcard__kind', { hasText: /Tedarikçi akreditasyonu|Kural önerisi/ }).count()), 'no admin-only card kinds');
    const { sheet, summary } = await openDecision(opsPage, `${p.code}: ödeme onayı`);
    await sheet.getByText('Vekil olarak onaylıyorsunuz').waitFor();
    await shot(opsPage, 'delegate-payment-sheet');
    await approveInSheet(sheet);
    await closedSheet(sheet, summary);
    const decided = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}&status=decided`)).items.find((x) => x.kind === 'payment_approval');
    if (decided) expect(decided.decidedBy === ops.id || decided.viaDelegation !== false, 'decided by the delegate');
    const pending = (await must(fin, 'GET', `/finance/entries?projectId=${p.projectId}`)).items.filter((e) => e.status === 'approved');
    expect(pending.length >= 1, 'payment approved by the delegate');
  });

  await step('After the delegation ends the ops user can no longer approve payments', async () => {
    await boss.goto(`${BASE}/yonetim/vekalet`);
    const row = boss.locator('tbody tr', { hasText: ops.fullName }).filter({ hasText: 'Aktif' }).first();
    await row.getByRole('button', { name: 'Sonlandır' }).click();
    await boss.locator('tbody tr', { hasText: ops.fullName }).first().getByText('Bitti').waitFor();
    endDelegation = null;
    await paymentRequest(fin, p, 2);
    await opsPage.goto(`${BASE}/`);
    await opsPage.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
    await opsPage.waitForLoadState('networkidle');
    expect(!(await opsPage.locator('.dcard', { hasText: `${p.code}: ödeme onayı` }).count()), 'payment card not shown to the former delegate');
    expect(!(await opsPage.getByText('Vekil olarak onaylıyorsunuz').count()), 'no delegate marker any more');
    const d = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}&status=open`)).items.find((x) => x.kind === 'payment_approval');
    allowHttp(/\/decisions\/[^/]+\/decide$/, 403, 'POST');
    const r = await apiAs(opsPage, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
    expect(r.status === 403, `API refuses the former delegate (${r.status})`);
    await shot(opsPage, 'former-delegate-inbox');
  });
}, { cleanup: async () => endDelegation?.() });
