// Senaryo 17 — Görsel kontrol: ana sayfalar 390 px (mobil) ve 1280 px'te yatay kaydırma olmadan açılır
// (document.scrollingElement.scrollWidth <= innerWidth) ve ekran görüntüsü alınır (deviceScaleFactor 1, SHOTS/17-visual-*.png).
import { scenario, step, newPage, expect, must, as, BASE, RUN, SHOTS, TODAY, TOMORROW } from '../lib/harness.mjs';
import { signedProject, createProject, arrangeOffers, rfqLinks } from '../lib/setup.mjs';

await scenario('17-visual', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await signedProject(boss, { customer: `Görsel Kontrol ${RUN}` });
  await must(boss, 'PATCH', `/projects/${p.projectId}`, { startDate: TODAY, endDate: TOMORROW });
  const rooming = (await must(boss, 'POST', `/projects/${p.projectId}/rooming-link`)).url;
  const r = await arrangeOffers(boss, await createProject(boss, { customer: `Görsel RFQ ${RUN}` }));
  const sups = (await must(boss, 'GET', '/suppliers?status=accredited&kind=accommodation')).items.slice(0, 3).map((s) => s.id);
  await must(boss, 'POST', `/items/${r.acc}/rfqs`, { supplierIds: sups });
  const rfq = (await rfqLinks(boss, r.projectId, r.acc))[0].url;
  const token = await boss.evaluate(() => localStorage.getItem('mice.token'));
  const fieldTok = await (async () => { const f = await as('field@demo.test', 'field-login', true); const t = await f.evaluate(() => localStorage.getItem('mice.token')); await f.context().close(); return t; })();
  const rel = (u) => u.replace(/^https?:\/\/[^/]+/, '');

  const pages = [
    ['inbox', '/'], ['projects', '/projeler'], ['intake', '/projeler/yeni'],
    ['project-overview', `/projeler/${p.projectId}`], ['project-items', `/projeler/${p.projectId}/items`], ['project-offers', `/projeler/${p.projectId}/offers`],
    ['project-comparison', `/projeler/${p.projectId}/comparison`], ['project-quote', `/projeler/${p.projectId}/quote`], ['project-contracts', `/projeler/${p.projectId}/contracts`],
    ['project-operations', `/projeler/${p.projectId}/operations`], ['project-finance', `/projeler/${p.projectId}/finance`], ['project-closing', `/projeler/${p.projectId}/closing`],
    ['finance', '/finans'], ['report', '/rapor'], ['rules', '/yonetim/kurallar'], ['users', '/yonetim/kullanicilar'], ['delegations', '/yonetim/vekalet'],
    ['automation', '/yonetim/otomasyon'], ['checklist', '/yonetim/kontrol-listesi'], ['suppliers', '/yonetim/tedarikciler'], ['customers', '/yonetim/musteriler'],
    ['field', '/saha', fieldTok], ['public-rfq', rel(rfq), null], ['public-rooming', rel(rooming), null], ['login', '/giris', null],
  ];
  const overflow = [];

  for (const [w, mobile] of [[390, true], [1280, false]]) {
    await step(`${w}px: ${pages.length} pages without horizontal scroll`, async () => {
      const page = await newPage(`visual-${w}`, mobile, mobile ? {} : { viewport: { width: 1280, height: 800 } });
      await page.goto(`${BASE}/giris`);
      for (const [name, path, tok = token] of pages) {
        await page.evaluate((t) => (t ? localStorage.setItem('mice.token', t) : localStorage.removeItem('mice.token')), tok);
        await page.goto(`${BASE}${path}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => {
          const se = document.scrollingElement;
          const wide = [...document.querySelectorAll('body *')].filter((el) => {
            const rr = el.getBoundingClientRect();
            if (rr.right <= window.innerWidth + 1 || rr.width === 0) return false;
            for (let a = el.parentElement; a; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false; }
            return true;
          }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
          return { sw: se.scrollWidth, iw: window.innerWidth, wide };
        });
        if (m.sw > m.iw) overflow.push(`${w}px ${name}: scrollWidth ${m.sw} > ${m.iw} (${m.wide.join(', ')})`);
        await page.screenshot({ path: `${SHOTS}/17-visual-${w}-${name}.png`, fullPage: true });
      }
      await page.context().close();
    });
  }
  await step('Result', async () => {
    if (overflow.length) console.log(`   overflow:\n     ${overflow.join('\n     ')}`);
    expect(!overflow.length, `${overflow.length} pages scroll horizontally`);
  });
});
