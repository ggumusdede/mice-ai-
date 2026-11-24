// Senaryo 13 — Banka ekstresi (§7 Adım 7): /finans'ta CSV yüklenir → içe aktarma özeti (Eşleşti / Öneri / Eşleşmedi) ve filtreler →
// fatura numaralı ödeme otomatik eşleşir, ilgisiz satır eşleşmez → referanssız tahsilat elle müşteri alacağına eşleştirilir.
import { scenario, step, as, expect, must, shot, BASE, RUN, TODAY, dmy, trNum, uploadFile } from '../lib/harness.mjs';
import { signedProject } from '../lib/setup.mjs';

await scenario('13-bank', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await signedProject(boss, { customer: `Banka Test ${RUN}` });
  const fin = await as('finance@demo.test', 'finance-desktop');
  const entries = (await must(fin, 'GET', `/finance/entries?projectId=${p.projectId}`)).items;
  const amount = Math.round(entries.filter((e) => e.kind === 'payable' && e.supplierId === p.moda).reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const receivable = entries.find((e) => e.kind === 'receivable');
  expect(receivable, 'receivable from the signed contract');
  const INV = `BNK-${RUN}`;
  const inv = await must(fin, 'POST', '/finance/supplier-invoices', { projectId: p.projectId, supplierId: p.moda, invoiceNo: INV, amount, currency: 'EUR', issueDate: TODAY });
  await must(fin, 'POST', '/finance/payment-requests', { entryId: inv.entry.id });
  const d = (await must(boss, 'GET', `/decisions?projectId=${p.projectId}&status=open`)).items.find((x) => x.kind === 'payment_approval');
  await must(boss, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
  await must(fin, 'POST', `/finance/entries/${inv.entry.id}/mark-paid`, { reference: `EFT-${RUN}` });

  const csv = Buffer.from([
    'Tarih;Açıklama;Tutar;Döviz;Karşı Taraf',
    `${dmy(TODAY)};EFT ${INV} Moda Sahil Otel odeme;-${trNum(amount)};EUR;Moda Sahil Otel`,
    `${dmy(TODAY)};Gelen havale ${RUN} etkinlik bedeli;${trNum(receivable.amount)};EUR;Banka Test ${RUN} A.S.`,
    `${dmy(TODAY)};Kırtasiye alımı ${RUN};-123,45;EUR;Kırtasiye Ltd`,
  ].join('\n'), 'utf8');

  await step('Upload the CSV → summary with matched / suggested / unmatched', async () => {
    await fin.goto(`${BASE}/finans`);
    const bank = fin.locator('.card', { hasText: 'Banka ekstresi' }).first();
    await bank.locator('table, .muted').first().waitFor();
    await uploadFile(bank, 'Ekstre yükle (CSV / XLSX)', { name: `ekstre-${RUN}.csv`, mimeType: 'text/csv', buffer: csv });
    const stats = bank.locator('.stats');
    await stats.waitFor();
    const n = async (label) => Number(await stats.locator('.stat', { hasText: label }).locator('.stat__value').innerText());
    const [read, matched, suggested, unmatched] = [await n('Okunan'), await n('Eşleşti'), await n('Öneri'), await n('Eşleşmedi')];
    console.log(`   imported ${read}: matched ${matched}, suggested ${suggested}, unmatched ${unmatched}`);
    expect(read === 3 && matched >= 1 && unmatched >= 1 && matched + suggested + unmatched === 3, 'summary adds up');
    await bank.locator('tr', { hasText: INV }).getByText('Eşleşti').first().waitFor();
    await bank.locator('tr', { hasText: `Kırtasiye alımı ${RUN}` }).getByText('Eşleşmedi').waitFor();
    // filters
    await bank.getByRole('radio', { name: /^Eşleşmedi/ }).click();
    await bank.locator('tr', { hasText: `Kırtasiye alımı ${RUN}` }).waitFor();
    expect(!(await bank.locator('tr', { hasText: INV }).count()), 'matched row hidden by the "Eşleşmedi" filter');
    await bank.getByRole('radio', { name: /^Tümü/ }).click();
    await shot(fin, 'bank-imported', true);
  });

  await step('Manual match of the incoming payment to the customer receivable', async () => {
    const bank = fin.locator('.card', { hasText: 'Banka ekstresi' }).first();
    const row = bank.locator('tr', { hasText: `Gelen havale ${RUN}` }).first();
    if (await row.getByText('Eşleşti', { exact: true }).count()) {
      console.log('   (incoming payment was matched automatically)');
      return;
    }
    await row.locator('select').selectOption(receivable.id);
    await row.getByRole('button', { name: 'Eşleştir' }).click();
    await row.locator('.pill', { hasText: 'Eşleşti' }).waitFor();
    const txs = (await must(fin, 'GET', '/finance/bank-transactions')).items;
    const tx = txs.find((x) => x.description.includes(`Gelen havale ${RUN}`));
    expect(tx.status === 'matched' && tx.matchedEntryId === receivable.id, 'stored manual match');
    await shot(fin, 'bank-manual-match', true);
  });
});
