// End-to-end UI scenario for workflow steps 0–5 (PRD §7) against an already running api (:3001) + web (:5173).
//
//   node e2e/steps0-5.mjs                 # BASE_URL=http://localhost:5173 SHOTS=./e2e/shots HEADED=1 optional
//
// Needs: seeded demo tenant (npm run seed -w apps/api -- --reset), AI_PROVIDER=mock on the api, Playwright
// (resolved globally via createRequire; no `playwright install`). Every run creates a fresh project from intake,
// so it can be rerun on the same database (it will additionally show the earlier runs as possible duplicates).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SHOTS = resolve(process.env.SHOTS ?? new URL('./shots', import.meta.url).pathname);
const PASSWORD = 'demo1234';
mkdirSync(SHOTS, { recursive: true });

const REQUEST_TEXT =
  "Merhaba, 12-14 Mart 2027 tarihlerinde Kadıköy'de 80 kişilik iki günlük toplantı için teklif rica ediyoruz. 30 SGL 25 DBL oda, " +
  'tiyatro düzeni salon, öğle yemeği ve 2 coffee break, havalimanı transferi. Bütçe kişi başı 250 EUR. Firma: Acme İlaç';

const SUPPLIER_EMAIL = `Sayın yetkili,
Toplantı salonu (tiyatro düzeni, 80 kişi) için 12-14 Mart 2027 teklifimiz:
Tam gün salon kirası: 1.200 EUR / gün, 2 gün, KDV hariç (%20).
Teknik ekipman (projeksiyon, ses sistemi) dahildir. Overtime 18:00 sonrası saatlik 150 EUR.
Opsiyon tarihi: 15 Ocak 2027. Ödeme: %30 ön ödeme, kalan etkinlikten 7 gün önce.
Saygılarımızla, Moda Sahil Otel Satış`;

// ---------------------------------------------------------------- harness
const problems = []; // unexpected API errors / page errors
const notes = []; // expected gaps (phase B routes)
const PHASE_B = /\/api\/(finance|reports|projects\/[^/]+\/(guests|field-extras|field-issues|daily-summary|closing-check|rooming-link|customer-invoice-draft|close)|tasks|delegations|users\/[^/]+\/stats)/;
let currentStep = 'setup';

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${currentStep}] ${label} pageerror: ${e.message}`));
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400) return;
    const body = (await r.text().catch(() => '')).slice(0, 300);
    const line = `[${currentStep}] ${label} ${r.request().method()} ${url.replace(BASE, '')} → ${r.status()} ${body}`;
    if (r.status() === 404 && PHASE_B.test(url)) notes.push(line);
    else if (r.status() >= 500 || r.status() === 404) problems.push(line);
    else console.log('   (4xx) ' + line); // validation answers are part of the flow
  });
}

async function newPage(browser, label, mobile = false) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  watch(page, label);
  return page;
}

async function login(page, email) {
  await page.goto(`${BASE}/giris`);
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/giris'));
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function step(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  await fn();
  console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

function expect(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

/** Admin inbox: open the first card matching `text`, approve via the primary action (dev biometric fallback when offered). */
async function adminDecide(admin, text, { action = 'approve', shotName } = {}) {
  await admin.goto(`${BASE}/`);
  await admin.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
  const card = admin.locator('.dcard:not(.dcard--skeleton)', { hasText: text }).first();
  await card.waitFor({ timeout: 10_000 });
  const summary = (await card.locator('.dcard__summary').innerText()).trim();
  await card.click();
  const sheet = admin.getByRole('dialog');
  await sheet.waitFor();
  if (shotName) await shot(admin, shotName);
  if (action === 'approve') {
    const reason = sheet.locator('#approve-reason');
    if (await reason.count()) await reason.fill('Stratejik müşteri — ilk iş, hacim potansiyeli yüksek');
    const dev = sheet.getByRole('button', { name: 'Geliştirici doğrulaması ile onayla' });
    if (await dev.count()) await dev.click();
    else {
      await sheet.locator('.sheet-actions > button').first().click();
      // production build (vite preview / nginx): headless WebAuthn fails → the dev fallback appears; use it
      if (await dev.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await dev.click();
    }
  } else {
    await sheet.getByRole('button', { name: 'Reddet' }).click();
    await sheet.getByLabel('Ret gerekçesi').fill(action.reason);
    await sheet.locator('.sheet-actions > button').first().click();
  }
  await sheet.waitFor({ state: 'detached', timeout: 15_000 }).catch(async () => {
    throw new Error(`decision "${summary}" not closed: ${await sheet.innerText()}`);
  });
  console.log(`   admin decided: ${summary}`);
  return summary;
}

async function openTab(page, projectId, tab) {
  await page.goto(`${BASE}/projeler/${projectId}/${tab}`);
  await page.waitForSelector('.tabs');
  await page.waitForLoadState('networkidle');
}

async function apiAs(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('mice.token')}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { method, path, body },
  );
}

/** The code's venue segment follows the selected accommodation / hall offer (PRJ-#### stays) — re-read it after a selection. */
async function refreshCode(page, id) {
  const r = await apiAs(page, 'GET', `/projects/${id}`);
  const code = r.json?.project?.code;
  expect(code && code.split('-').slice(0, 2).join('-') === projectCode.split('-').slice(0, 2).join('-'), `PRJ sequence stable (${projectCode} → ${code})`);
  if (code !== projectCode) console.log(`   project code → ${code}`);
  projectCode = code;
}

// ---------------------------------------------------------------- scenario
const browser = await chromium.launch({ headless: !process.env.HEADED });
const clerk = await newPage(browser, 'clerk');
const admin = await newPage(browser, 'admin', true);
let projectId = '';
let projectCode = '';

try {
  await step('0 · Intake (clerk, "Yeni talep")', async () => {
    await login(clerk, 'clerk@demo.test');
    await clerk.getByRole('link', { name: /Yeni talep/ }).first().click();
    await clerk.locator('#intake-body').fill(REQUEST_TEXT);
    await clerk.getByLabel('Gönderen (e-posta / telefon)').fill('etkinlik@acme-ilac.example');
    await clerk.getByRole('button', { name: /Analiz et/ }).click();
    const open = clerk.getByRole('link', { name: 'Projeyi aç' });
    await open.waitFor({ timeout: 30_000 });
    projectId = (await open.getAttribute('href')).split('/').pop();
    const main = await clerk.locator('main').innerText();
    projectCode = main.match(/PRJ-[\w-]+/)[0];
    expect(/Kişi sayısı\s+%\d+\s+80/.test(main), 'pax 80 extracted');
    expect(main.includes('Acme İlaç'), 'customer extracted');
    expect(main.includes('Eksik bilgiler'), 'missing list shown');
    expect(await clerk.locator('#qdraft').inputValue().then((v) => v.length > 20), 'question draft');
    expect(main.includes('Ön eşleşen tedarikçiler') && main.includes('Aynı semt'), 'pre-matched suppliers');
    expect(main.includes('Atama önerisi'), 'assignment suggestion');
    // human verification of a low-confidence / missing field (customer answered by phone)
    const billing = clerk.locator('.extract', { hasText: 'Fatura bilgisi' });
    await billing.locator('input').fill('Acme İlaç San. A.Ş., Kozyatağı VD, 1234567890');
    await billing.getByRole('button', { name: 'Doğrulayın' }).click();
    await billing.getByText('Doğrulandı').waitFor();
    await clerk.getByRole('button', { name: 'Taslağı kaydet' }).click();
    await clerk.getByText('Kaydedildi').first().waitFor();
    console.log(`   project ${projectCode} (${projectId})`);
    await shot(clerk, 'step0-intake', true);
  });

  await step('1 · Admin decision inbox (390×844): approve assignment', async () => {
    await login(admin, 'admin@demo.test');
    await shot(admin, 'inbox-mobile');
    await adminDecide(admin, `${projectCode}: `, { shotName: 'inbox-sheet-assignment' });
    // the toast shows humanized effects
    await admin.getByText(/Karar kaydedildi · Proje atandı/).first().waitFor();
  });

  await step('3a · Project screen: add item, shortlist, RFQ to 3 suppliers', async () => {
    await openTab(clerk, projectId, 'items');
    // intake already created accommodation / hall / F&B / transfer items; add a technical one
    await clerk.getByRole('button', { name: 'Kalem ekle' }).click();
    await clerk.getByLabel('Tür').selectOption('technical');
    await clerk.getByLabel('Açıklama').fill('Teknik: projeksiyon, ses sistemi, 2 telsiz mikrofon');
    await clerk.getByLabel('Miktar').fill('2');
    await clerk.getByRole('button', { name: 'Ekle', exact: true }).click();
    await clerk.locator('.card', { hasText: 'Teknik: projeksiyon' }).waitFor();

    const acc = clerk.locator('.card', { hasText: 'Konaklama 30 SGL' }).first();
    await acc.getByRole('button', { name: 'Kısa listeyi getir' }).click();
    await acc.getByText(/3–5 tedarikçi seçin \(3\)/).waitFor();
    await acc.getByRole('button', { name: 'RFQ taslaklarını oluştur' }).click();
    await acc.getByRole('cell', { name: 'Onay bekliyor' }).first().waitFor();
    expect((await acc.getByRole('cell', { name: 'Onay bekliyor' }).count()) === 3, '3 RFQ drafts pending approval');
  });

  await step('3b · Admin approves rfq_send', async () => {
    await adminDecide(admin, `${projectCode}: Konaklama`, { shotName: 'inbox-sheet-rfq' });
  });

  const links = [];
  await step('3c · Supplier links (POST /api/rfqs/:id/link via UI)', async () => {
    await openTab(clerk, projectId, 'items');
    const acc = clerk.locator('.card', { hasText: 'Konaklama 30 SGL' }).first();
    const btns = acc.getByRole('button', { name: 'Tedarikçi linki' });
    expect((await btns.count()) === 3, '3 sent RFQs with link buttons');
    for (let i = 0; i < 3; i++) {
      await btns.nth(i).click();
      await acc.locator('.copy-link__url').nth(i).waitFor();
    }
    links.push(...(await acc.locator('.copy-link__url').allInnerTexts()));
    expect(links.every((l) => /\/s\/rfq\/[\w-]+$/.test(l)), 'supplier links');
    await shot(clerk, 'project-items-desktop', true);
  });

  await step('3d · Suppliers submit offers on /s/rfq/<token>', async () => {
    const prices = [
      { sgl: 118, dbl: 135, prepay: 30 },
      { sgl: 150, dbl: 168, prepay: 20 },
      { sgl: 128, dbl: 140, prepay: 50 },
    ];
    for (const [i, url] of links.entries()) {
      const sup = await newPage(browser, `supplier${i + 1}`, true);
      await sup.goto(url);
      await sup.locator('.lines__row').first().waitFor();
      // [Ürün kararı] hideCustomerFromSuppliers (default on): the supplier sees PRJ-####-<date>-<pax>, never the customer
      const [pfx, seq, customerSeg, date, pax] = projectCode.split('-');
      const pageText = await sup.locator('body').innerText();
      expect(!pageText.includes(customerSeg), `supplier page hides the customer segment (${customerSeg})`);
      expect(pageText.includes(`${pfx}-${seq}-${date}-${pax}`), 'supplier page shows the supplier-safe reference');
      const row1 = sup.locator('.lines__row').nth(0);
      await row1.getByLabel('Açıklama', { exact: true }).fill('SGL oda, oda+kahvaltı');
      await row1.locator('label', { hasText: 'Oda tipi' }).locator('select').selectOption('SGL');
      await row1.getByLabel('Adet', { exact: true }).fill('30');
      await row1.getByLabel(/Birim fiyat/).fill(String(prices[i].sgl));
      await sup.getByRole('button', { name: 'Satır ekle' }).click();
      const row2 = sup.locator('.lines__row').nth(1);
      await row2.getByLabel('Açıklama', { exact: true }).fill('DBL oda, oda+kahvaltı');
      await row2.locator('label', { hasText: 'Oda tipi' }).locator('select').selectOption('DBL');
      await row2.getByLabel('Adet', { exact: true }).fill('25');
      await row2.getByLabel(/Birim fiyat/).fill(String(prices[i].dbl));
      await sup.getByLabel('Opsiyon').fill('2027-01-20');
      await sup.getByLabel('Garanti kişi').fill('70');
      await sup.getByLabel('Ön ödeme %').fill(String(prices[i].prepay));
      await sup.getByLabel('İptal koşulları').fill('30 gün öncesine kadar ücretsiz iptal');
      if (i === 0) await shot(sup, 'supplier-form', true);
      await sup.getByRole('button', { name: 'Teklifi gönder' }).click();
      await sup.getByText(/Teklifiniz alındı \(sürüm \d+\)/).first().waitFor();
      if (i === 0) await shot(sup, 'supplier-form-sent');
      await sup.context().close();
    }
  });

  await step('3e · Paste supplier e-mail into offer parse (hall)', async () => {
    await openTab(clerk, projectId, 'offers');
    const hall = clerk.locator('.card', { hasText: 'Salon' }).first();
    await hall.getByRole('button', { name: 'Yapay zekâ ile oku' }).click();
    await hall.getByLabel('Tedarikçi').selectOption({ label: 'Moda Sahil Otel' });
    await hall.getByLabel('Metin yapıştır').fill(SUPPLIER_EMAIL);
    await hall.locator('.row-end').getByRole('button', { name: 'Yapay zekâ ile oku' }).click();
    await hall.getByRole('cell', { name: /Moda Sahil Otel/ }).first().waitFor({ timeout: 30_000 });
    // low-confidence readings need human verification
    const verify = hall.getByRole('button', { name: 'Doğrula', exact: true });
    if (await verify.count()) {
      await verify.first().click();
      await hall.getByRole('button', { name: 'Doğrula ve kaydet' }).click();
      await hall.getByRole('button', { name: 'Doğrula ve kaydet' }).waitFor({ state: 'detached' });
    }
    // select the parsed hall offer
    const sel = hall.getByRole('button', { name: 'Bu teklifi seç' });
    if (await sel.count()) {
      await sel.first().click();
      await hall.getByText('Seçili').first().waitFor();
    }
    await refreshCode(clerk, projectId);
    await shot(clerk, 'project-offers-desktop', true);
  });

  await step('4a · Comparison & negotiation draft', async () => {
    await openTab(clerk, projectId, 'comparison');
    const acc = clerk.locator('.card', { hasText: 'Konaklama 30 SGL' }).first();
    await acc.locator('.compare__col').first().waitFor();
    expect((await acc.locator('.compare__col').count()) >= 3, '3 offers compared');
    await acc.getByRole('button', { name: /Pazarlık taslağı hazırla · Tur 1/ }).first().click();
    const neg = acc.locator('fieldset.subcard');
    await neg.getByLabel('Esnek tarih').check();
    await neg.getByRole('button', { name: 'Pazarlık taslağı hazırla' }).click();
    await clerk.getByText(/Pazarlık taslağı hazırlandı/).first().waitFor({ timeout: 20_000 });
    await shot(clerk, 'project-comparison-desktop', true);
    await adminDecide(admin, `${projectCode}`, { shotName: 'inbox-sheet-negotiation' });

    // pick the cheapest accommodation offer
    await openTab(clerk, projectId, 'offers');
    const accOffers = clerk.locator('.card', { hasText: 'Konaklama 30 SGL' }).first();
    await accOffers.getByRole('button', { name: 'Bu teklifi seç' }).first().click();
    await accOffers.getByText('Seçili').first().waitFor();
    await clerk.waitForLoadState('networkidle');
    await refreshCode(clerk, projectId);
    expect(/-[A-Z0-9]+$/.test(projectCode) && !projectCode.endsWith('-TBD'), 'venue segment set from the selected hotel');
  });

  let quoteLink = '';
  await step('4b · Quote builder with 2 options → validation → admin approval (biometric dev) → send', async () => {
    await openTab(clerk, projectId, 'quote');
    const builder = clerk.locator('.card', { hasText: 'Teklif oluşturucu' }).first();
    await builder.locator('.qb__opt').nth(1).waitFor();
    // only quote items that have offers: untick lines without an offer
    for (const opt of await builder.locator('.qb__opt').all()) {
      for (const line of await opt.locator('.qb__line').all()) {
        if (await line.getByText('Teklif yok').count()) await line.locator('input[type=checkbox]').uncheck();
      }
    }
    await builder.locator('#opt-title-0').fill('Seçenek A — Kadıköy deniz manzaralı');
    await builder.locator('#opt-title-1').fill('Seçenek B — alternatif otel');
    // 1st build with the suggested markups (new suppliers → low markup) → validation blocks below target margin
    const build = async () => {
      const [resp] = await Promise.all([
        clerk.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${projectId}/quotes`), { timeout: 20_000 }),
        builder.getByRole('button', { name: 'Teklifi doğrula' }).click(),
      ]);
      const q = await resp.json();
      await builder.locator('.callout').first().waitFor();
      console.log(`   quote v${q.version} status=${q.status} blocks=${JSON.stringify(q.blockReasons)}`);
      return q;
    };
    // force a below-target margin on option 2 so the server-side validation blocks it
    for (const input of await builder.locator('.qb__opt').nth(1).locator('.inline-field--num input').all()) await input.fill('2');
    let q = await build();
    await shot(clerk, 'project-quote-desktop', true);
    if (q.status === 'blocked') {
      expect(q.blockReasons.length > 0, 'block reasons listed');
      // raise every markup to 22 % and rebuild
      for (const input of await builder.locator('.inline-field--num input').all()) await input.fill('22');
      q = await build();
    }
    expect(q.status === 'pending_approval' || q.status === 'approved', `quote not blocked after fixing markup (${q.status})`);
    if (q.status === 'pending_approval') {
      await adminDecide(admin, `${projectCode}`, { shotName: 'inbox-sheet-quote' });
    }
    await openTab(clerk, projectId, 'quote');
    const card = clerk.locator('.card', { hasText: /^v\d/ }).filter({ hasText: 'Onaylandı' }).first();
    await card.getByRole('button', { name: 'Müşteriye gönder' }).click();
    await clerk.locator('.copy-link__url').first().waitFor({ timeout: 20_000 });
    quoteLink = await clerk.locator('.copy-link__url').first().innerText();
    expect(/\/q\/[\w-]+$/.test(quoteLink), 'quote approval link');
  });

  await step('4c · Customer opens /q/<token> and accepts', async () => {
    const cust = await newPage(browser, 'customer', true);
    await cust.goto(quoteLink);
    await cust.locator('.qopts').waitFor();
    await shot(cust, 'customer-quote', true);
    await cust.getByRole('radio', { name: 'Bu seçeneği seç' }).first().click();
    await cust.getByLabel('Adınız soyadınız').fill('Ayşe Yılmaz (Acme İlaç)');
    const po = cust.getByLabel('PO numarası');
    if (await po.count()) await po.fill('PO-2027-0042');
    await cust.getByRole('button', { name: 'Teklifi onayla' }).click();
    await cust.getByText('Onayınız alındı. Teşekkürler!').first().waitFor({ timeout: 15_000 });
    await shot(cust, 'customer-quote-accepted');
    await cust.context().close();
  });

  await step('5 · Contract: template → compare → risk → approval (biometric) → sign → locked', async () => {
    await openTab(clerk, projectId, 'contracts');
    await clerk.getByRole('button', { name: 'Şablondan oluştur' }).click();
    const form = clerk.locator('.card', { hasText: 'Şablondan oluştur' }).last();
    await form.getByRole('button', { name: 'Oluştur' }).click();
    const contract = clerk.locator('.card', { hasText: /v\d+/ }).filter({ hasText: 'Taslak' }).first();
    await contract.waitFor();
    const [cmp] = await Promise.all([
      clerk.waitForResponse((r) => r.request().method() === 'POST' && /\/contracts\/[^/]+\/compare$/.test(r.url())),
      contract.getByRole('button', { name: 'Teklifle karşılaştır' }).click(),
    ]);
    const con = await cmp.json();
    await clerk.waitForLoadState('networkidle');
    console.log(`   contract status=${con.status} diff=${con.diff.length} conditionRiskEur=${con.conditionRiskEur}`);
    await shot(clerk, 'project-contract-compared', true);
    if (con.conditionRiskEur > 0) await adminDecide(admin, `${projectCode}: karşılıklı koşul riski`, { shotName: 'inbox-sheet-condition-risk' });
    await adminDecide(admin, new RegExp(`${projectCode}: .*sözleşmesi temiz`), { shotName: 'inbox-sheet-contract' });

    // sign (admin = signatory) — scan upload + signer
    const signer = await newPage(browser, 'admin-desktop');
    await login(signer, 'admin@demo.test');
    await openTab(signer, projectId, 'contracts');
    const card = signer.locator('.card').filter({ hasText: 'Onaylandı' }).first();
    await card.getByRole('button', { name: /İmzala/ }).click();
    await card.locator('input[type=file]').setInputFiles({ name: 'sozlesme-imzali.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
    await card.locator('.subcard').getByRole('button', { name: /İmzala/ }).click();
    await signer.locator('.card').filter({ hasText: 'Kilitli' }).first().waitFor();
    await shot(signer, 'project-contract-signed', true);
    const fin = await apiAs(signer, 'GET', `/finance/entries?projectId=${projectId}`);
    if (fin.status === 200) {
      const kinds = fin.json.items.map((e) => e.kind);
      console.log(`   finance entries: ${kinds.join(', ')}`);
      expect(kinds.includes('payable') && kinds.includes('receivable'), 'payable + receivable created');
    } else {
      notes.push(`[5] finance entries could not be listed via API (${fin.status}) — phase B route`);
    }
    await signer.context().close();
  });

  await step('Inbox empty → "Her şey yolunda"', async () => {
    // clear anything still open for this project (e.g. outbound drafts)
    for (let i = 0; i < 40; i++) {
      await admin.goto(`${BASE}/`);
      await admin.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
      if (await admin.locator('.allgood').count()) break;
      await adminDecide(admin, '');
    }
    await admin.locator('.allgood', { hasText: 'Her şey yolunda' }).waitFor();
    await shot(admin, 'inbox-allgood');
  });

  await step('Seeded projects, field panel, weekly report render', async () => {
    await clerk.goto(`${BASE}/projeler`);
    await clerk.locator('table a').first().waitFor();
    for (const code of ['PRJ-0001', 'PRJ-0002']) {
      await clerk.locator('table a', { hasText: code }).first().click();
      await clerk.waitForSelector('.tabs');
      await clerk.waitForLoadState('networkidle');
      expect(!(await clerk.getByText('Proje bulunamadı').count()), `${code} renders`);
      await shot(clerk, `seed-${code}`, true);
      await clerk.goBack();
    }
    const field = await newPage(browser, 'field', true);
    await login(field, 'field@demo.test');
    await field.goto(`${BASE}/saha`);
    await field.waitForLoadState('networkidle');
    await shot(field, 'field-panel');
    // least privilege ([Ürün kararı] fieldRoleCanSeeFinancials, default off): no money tabs / profit, API refuses finance
    await field.goto(`${BASE}/projeler/${projectId}`);
    await field.waitForSelector('.tabs');
    await field.waitForLoadState('networkidle');
    expect(!(await field.locator('.tabs__tab', { hasText: 'Finans' }).count()), 'field: no Finans tab');
    expect(!(await field.locator('.tabs__tab', { hasText: 'Müşteri teklifi' }).count()), 'field: no quote tab');
    expect(!(await field.getByText('Beklenen kâr').count()), 'field: no profit block');
    const fin = await field.evaluate(async (id) => (await fetch(`/api/finance/entries?projectId=${id}`, { headers: { authorization: `Bearer ${localStorage.getItem('mice.token')}` } })).status, projectId);
    expect(fin === 403, `field: finance entries refused (${fin})`);
    await shot(field, 'field-project-no-financials');
    await field.context().close();
    const boss = await newPage(browser, 'admin-report');
    await login(boss, 'admin@demo.test');
    await boss.goto(`${BASE}/rapor`);
    await boss.waitForLoadState('networkidle');
    await shot(boss, 'weekly-report', true);
    await boss.context().close();
  });
} catch (e) {
  problems.push(`[${currentStep}] FAILED: ${e.message.split('\n')[0]}`);
  await clerk.screenshot({ path: `${SHOTS}/FAILED-clerk.png`, fullPage: true }).catch(() => {});
  await admin.screenshot({ path: `${SHOTS}/FAILED-admin.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (notes.length) console.log(`\nExpected gaps (phase B, ${notes.length}):\n  ${[...new Set(notes.map((n) => n.replace(/[0-9a-f-]{36}/g, ':id')))].join('\n  ')}`);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nALL STEPS PASSED');
