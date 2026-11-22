// Senaryo 5 — Eski belge (§3.5, ana çatı 4): onaylı teklifin PDF'i üretildikten sonra kişi sayısı değişir → yan panelde
// "Müşteri teklifi" "Eski", "Müşteriye gönder" reddedilir (409 DOCUMENT_STALE); fiyatı etkileyen değişiklikte "Yeniden üret" de
// reddedilir (yeni teklif sürümü gerekir) → v2. Fiyatı etkilemeyen değişiklikte (proje başlığı) "Yeniden üret" → "Güncel" → gönderim.
import { scenario, step, as, expect, must, openTab, shot, allowHttp } from '../lib/harness.mjs';
import { approvedQuote, arrangeOffers, createProject } from '../lib/setup.mjs';

await scenario('05-stale', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');
  const p = await arrangeOffers(boss, await createProject(boss, { customer: 'Eski Belge Ltd' }));
  await approvedQuote(boss, p);
  const quoteDoc = (page) => page.locator('.project__side .list__row', { hasText: 'Müşteri teklifi' }).first();

  await step('Quote PDF is current, then pax changes → "Eski"', async () => {
    await openTab(boss, p.projectId, 'quote');
    await quoteDoc(boss).getByText('Güncel').waitFor();
    await must(boss, 'PATCH', `/projects/${p.projectId}`, { pax: 70, reason: 'Müşteri telefonda 70 kişi dedi' });
    await openTab(boss, p.projectId, 'quote');
    await quoteDoc(boss).getByText('Eski').waitFor();
    await boss.locator('.alerts').getByText(/Müşteri teklifi güncel değil/).first().waitFor();
    await shot(boss, 'quote-doc-stale', true);
  });

  await step('Send is blocked while the document is stale; pricing change → regenerate refused', async () => {
    allowHttp(/\/quotes\/[^/]+\/send$/, 409, 'POST');
    allowHttp(/\/documents\/[^/]+\/regenerate$/, 409, 'POST');
    const card = boss.locator('.card', { hasText: /^v1/ }).first();
    await card.getByRole('button', { name: 'Müşteriye gönder' }).click();
    await boss.locator('.toast--danger', { hasText: /belgesi eski/ }).waitFor();
    expect(!(await card.locator('.copy-link__url').count()), 'no approval link');
    await quoteDoc(boss).getByRole('button', { name: /Yeniden üret/ }).click();
    await boss.locator('.toast--danger', { hasText: /yeni teklif sürümü/ }).waitFor();
    const q = await must(boss, 'GET', `/quotes/${p.quoteId}`);
    expect(q.status === 'approved' && !q.sentAt, `v1 not sent (${q.status})`);
    await shot(boss, 'quote-send-blocked', true);
  });

  await step('v2 for the new pax; a non-pricing change (title) → regenerate → current → send', async () => {
    await approvedQuote(boss, p);
    await must(boss, 'PATCH', `/projects/${p.projectId}`, { title: 'Bayi toplantısı 2027 (güncel başlık)' });
    await openTab(boss, p.projectId, 'quote');
    await quoteDoc(boss).getByText('Eski').waitFor();
    await quoteDoc(boss).getByRole('button', { name: /Yeniden üret/ }).click();
    await quoteDoc(boss).getByText('Güncel').waitFor();
    const card = boss.locator('.card', { hasText: /^v2/ }).first();
    await card.getByRole('button', { name: 'Müşteriye gönder' }).click();
    const link = await card.locator('.copy-link__url').innerText({ timeout: 20_000 });
    expect(/\/q\/[\w-]+$/.test(link), 'v2 sent after regeneration');
    await shot(boss, 'quote-regenerated-sent', true);
  });
});
