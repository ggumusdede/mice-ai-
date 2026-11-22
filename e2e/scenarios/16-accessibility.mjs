// Senaryo 16 — Erişilebilirlik dumanı (yeni bağımlılık yok): yalnız klavyeyle giriş → karar kutusu → kart Enter ile açılır →
// alt panel odak tuzağı (Tab / Shift+Tab dışarı çıkmaz) → Escape kapatır ve odak karta döner · konsol hatası yok ·
// ana sayfalarda axe benzeri kontroller: form alanlarının etiketi, düğme / linklerin erişilebilir adı, görsellerde alt, <html lang>.
import { scenario, step, newPage, expect, shot, BASE, PASSWORD, RUN, consoleErrors, as, must } from '../lib/harness.mjs';
import { createProject, arrangeOffers, sentQuote } from '../lib/setup.mjs';

/** Runs in the page: returns human-readable violations for visible controls. */
function audit() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const byIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ').trim();
  const name = (el) => {
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    if (el.getAttribute('aria-labelledby')) { const n = byIds(el.getAttribute('aria-labelledby')); if (n) return n; }
    if (el.labels?.length) { const n = [...el.labels].map(text).join(' ').trim(); if (n) return n; }
    if (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName)) {
      const n = text(el) || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ').trim();
      if (n) return n;
    }
    return el.getAttribute('title')?.trim() ?? '';
  };
  const out = [];
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el) || el.getAttribute('aria-hidden') === 'true') continue;
    if (!name(el)) out.push(`unlabelled ${desc(el)}${el.placeholder ? ` (placeholder only: "${el.placeholder}")` : ''}`);
  }
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=radio], [role=tab]')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    if (!name(el)) out.push(`no accessible name: ${desc(el)}`);
  }
  for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`img without alt: ${img.src.slice(-40)}`);
  if (!document.documentElement.lang) out.push('<html> without lang');
  const h1 = document.querySelectorAll('h1').length;
  if (h1 === 0) out.push('no <h1>');
  return out;
}

await scenario('16-a11y', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await arrangeOffers(boss, await createProject(boss, { customer: `Erişilebilirlik ${RUN}` }));
  await sentQuote(boss, p);
  await boss.context().close();
  const page = await newPage('keyboard', true);

  await step('Keyboard-only login', async () => {
    await page.goto(`${BASE}/giris`);
    await page.locator('input').first().waitFor();
    let guard = 0;
    while (!(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'email' || document.activeElement?.getAttribute('autocomplete') === 'username')) && guard++ < 10) await page.keyboard.press('Tab');
    expect(guard < 10, 'e-mail field reachable with Tab');
    await page.keyboard.type('admin@demo.test');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'password'), 'Tab moves to the password field');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await page.locator('.dcard:not(.dcard--skeleton), .allgood').first().waitFor();
  });

  await step('Inbox → card with Enter → focus trapped in the sheet → Escape closes, focus returns', async () => {
    let guard = 0;
    while (!(await page.evaluate(() => document.activeElement?.classList.contains('dcard'))) && guard++ < 60) await page.keyboard.press('Tab');
    expect(guard < 60, 'a decision card is reachable with Tab');
    const cardText = await page.evaluate(() => document.activeElement.querySelector('.dcard__summary')?.textContent);
    const focusRing = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'; });
    expect(focusRing, 'visible focus indicator on the card');
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog');
    await sheet.waitFor();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'focus moved into the dialog');
    expect(await sheet.getAttribute('aria-modal') === 'true' && !!(await sheet.getAttribute('aria-labelledby')), 'aria-modal + labelled dialog');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), `Tab #${i + 1} stays inside the dialog`);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'Shift+Tab stays inside the dialog');
    }
    await shot(page, 'sheet-keyboard');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    expect(await page.evaluate((t) => document.activeElement?.classList.contains('dcard') && document.activeElement.querySelector('.dcard__summary')?.textContent === t, cardText), 'focus restored to the card');
  });

  await step('Axe-like checks on the main pages (mobile and desktop)', async () => {
    const desk = await newPage('audit-desktop');
    await desk.goto(`${BASE}/giris`);
    await desk.evaluate(async (token) => localStorage.setItem('mice.token', token), await page.evaluate(() => localStorage.getItem('mice.token')));
    const pages = ['/', '/projeler', `/projeler/${p.projectId}`, `/projeler/${p.projectId}/items`, `/projeler/${p.projectId}/quote`, `/projeler/${p.projectId}/operations`,
      '/projeler/yeni', '/saha', '/finans', '/rapor', '/yonetim/kurallar', '/yonetim/vekalet', '/yonetim/tedarikciler', p.quoteLink.replace(/^https?:\/\/[^/]+/, '')];
    const violations = [];
    for (const pg of [page, desk]) {
      for (const path of pages) {
        await pg.goto(`${BASE}${path}`);
        await pg.waitForLoadState('networkidle');
        await pg.waitForTimeout(200);
        for (const v of await pg.evaluate(audit)) violations.push(`${pg === page ? '390' : '1366'} ${path.replace(/[0-9a-f-]{36}/, ':id').replace(/\/q\/.*/, '/q/:token')}: ${v}`);
      }
    }
    const unique = [...new Set(violations)];
    if (unique.length) console.log(`   violations:\n     ${unique.join('\n     ')}`);
    expect(!unique.length, `${unique.length} accessibility violations`);
  });

  await step('No console errors', async () => {
    expect(!consoleErrors.length, `console errors:\n  ${consoleErrors.join('\n  ')}`);
  });
  void must;
});
