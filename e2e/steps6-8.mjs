// End-to-end UI scenario for workflow steps 6–8 (PRD §7 Adım 6 operasyon, 7 finans, 8 kapanış) + weekly report and admin
// screens, against an already running api (:3001) + web (:5173).
//
//   node e2e/steps6-8.mjs                 # BASE_URL=http://localhost:5173 SHOTS=./e2e/shots HEADED=1 optional
//
// To save time the project is arranged through the API up to a COMPARED contract (intake → offers → 2-option quote → customer
// acceptance on the public token route → agency-template contract → compare). The request carries no billing info, so the
// contract is not clean; the UI then fixes the billing info in the project Overview, re-compares, the admin approves on the
// mobile inbox (dev biometric) and the contract is signed. Before the field step the event dates are moved to today/tomorrow (field panel "Bugünkü projeler").
// Every run creates a fresh project (unique invoice numbers), so it can be rerun on the same database.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SHOTS = resolve(process.env.SHOTS ?? new URL('./shots', import.meta.url).pathname);
const PASSWORD = 'demo1234';
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const TODAY = ymd(new Date());
const TOMORROW = ymd(new Date(Date.now() + 86_400_000));
const dmy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const trNum = (n) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- harness (same conventions as steps0-5.mjs)
const problems = [];
let currentStep = 'setup';

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${currentStep}] ${label} pageerror: ${e.message}`));
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400) return;
    const body = (await r.text().catch(() => '')).slice(0, 300);
    const line = `[${currentStep}] ${label} ${r.request().method()} ${url.replace(BASE, '')} → ${r.status()} ${body}`;
    if (r.status() >= 500 || r.status() === 404) problems.push(line);
    else console.log('   (4xx) ' + line);
  });
}

async function newPage(browser, label, mobile = false) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true }
      : { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true },
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

async function apiAs(page, method, path, body, { auth = true } = {}) {
  return page.evaluate(
    async ({ method, path, body, auth }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = `Bearer ${localStorage.getItem('mice.token')}`;
      const payload = body ?? (method === 'GET' ? undefined : {});
      const r = await fetch(`/api${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { method, path, body, auth },
  );
}

async function must(page, method, path, body, opts) {
  const r = await apiAs(page, method, path, body, opts);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

/** Admin inbox: open the first card matching `text`, approve via the primary action (dev biometric fallback when offered). */
async function adminDecide(admin, text, { shotName, edits } = {}) {
  await admin.goto(`${BASE}/`);
  await admin.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
  const card = admin.locator('.dcard:not(.dcard--skeleton)', { hasText: text }).first();
  await card.waitFor({ timeout: 10_000 });
  const summary = (await card.locator('.dcard__summary').innerText()).trim();
  await card.click();
  const sheet = admin.getByRole('dialog');
  await sheet.waitFor();
  if (shotName) await shot(admin, shotName);
  const reason = sheet.locator('#approve-reason');
  if (await reason.count()) await reason.fill('Stratejik müşteri — e2e');
  const dev = sheet.getByRole('button', { name: 'Geliştirici doğrulaması ile onayla' });
  if (await dev.count()) await dev.click();
  else await sheet.locator('.sheet-actions > button').first().click();
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

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), click()]);
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

async function uploadFile(scope, buttonName, file) {
  // FilePicker = hidden <input type=file> next to its button
  const picker = scope.locator('.file-picker', { has: scope.page().getByRole('button', { name: buttonName }) }).first();
  await picker.locator('input[type=file]').setInputFiles(file);
}

// ---------------------------------------------------------------- scenario
const browser = await chromium.launch({ headless: !process.env.HEADED });
const boss = await newPage(browser, 'admin-desktop');
const admin = await newPage(browser, 'admin-mobile', true);
let projectId = '';
let projectCode = '';
let adminUserId = '';
const sup = {}; // supplier ids by name
const ids = {};

try {
  await step('Setup (API): project up to a compared contract', async () => {
    await login(boss, 'admin@demo.test');
    await login(admin, 'admin@demo.test');
    adminUserId = (await must(boss, 'GET', '/auth/me')).user.id;
    for (const s of (await must(boss, 'GET', '/suppliers')).items) sup[s.name] = s.id;
    const moda = sup['Moda Sahil Otel'];
    expect(moda, 'seeded supplier Moda Sahil Otel');
    const intake = await must(boss, 'POST', '/intake', {
      channel: 'email', fromAddress: 'etkinlik@deniz-lojistik.example',
      body: "Merhaba, 12-13 Mart 2027 tarihlerinde Kadıköy'de 60 kişilik bayi toplantısı için teklif rica ediyoruz. 20 SGL 20 DBL oda, tiyatro düzeni salon. Firma: Deniz Lojistik",
    });
    projectId = intake.project.id;
    let detail = await must(boss, 'GET', `/projects/${projectId}`);
    const acc = detail.items.find((i) => i.kind === 'accommodation');
    const hall = detail.items.find((i) => i.kind === 'hall');
    expect(acc && hall, 'accommodation + hall items from intake');
    await must(boss, 'PATCH', `/items/${acc.id}`, { nights: 1 });
    for (const it of detail.items.filter((i) => !['accommodation', 'hall'].includes(i.kind))) await must(boss, 'PATCH', `/items/${it.id}`, { status: 'cancelled' });
    const accLines = (sgl, dbl) => [
      { description: 'Oda (SGL, BB)', kind: 'accommodation', quantity: 20, unit: 'room_night', nights: 1, unitPrice: sgl, vatIncluded: false, vatRate: 0.1, roomType: 'SGL', board: 'BB' },
      { description: 'Oda (DBL, BB)', kind: 'accommodation', quantity: 20, unit: 'room_night', nights: 1, unitPrice: dbl, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB' },
    ];
    const offer = (item, supplierId, lines) => must(boss, 'POST', `/items/${item}/offers`, {
      supplierId, source: 'email', currency: 'EUR', lines, optionUntil: '2027-01-20', guaranteePax: 55, prepaymentRate: 0.3, paymentTerms: '%30 ön ödeme', cancellationTerms: '7 gün öncesine kadar ücretsiz',
    });
    const oA = await offer(acc.id, moda, accLines(95, 110));
    const oB = await offer(acc.id, sup['Kalamış Marina Hotel'], accLines(120, 140));
    const oH = await offer(hall.id, moda, [{ description: 'Salon (tiyatro)', kind: 'hall', quantity: 1, unit: 'day', unitPrice: 1200, vatIncluded: false, vatRate: 0.2 }]);
    await must(boss, 'POST', `/items/${acc.id}/select-offer`, { offerId: oA.id });
    await must(boss, 'POST', `/items/${hall.id}/select-offer`, { offerId: oH.id });
    const quote = await must(boss, 'POST', `/projects/${projectId}/quotes`, {
      options: [
        { title: 'Moda Sahil', lines: [{ serviceItemId: acc.id, offerId: oA.id, markup: 0.2 }, { serviceItemId: hall.id, offerId: oH.id, markup: 0.2 }] },
        { title: 'Alternatif', lines: [{ serviceItemId: acc.id, offerId: oB.id, markup: 0.2 }, { serviceItemId: hall.id, offerId: oH.id, markup: 0.2 }] },
      ],
    });
    if (quote.status === 'pending_approval') {
      const d = (await must(boss, 'GET', `/decisions?projectId=${projectId}`)).items.find((x) => x.kind === 'quote_approval');
      expect(d.requiresBiometric, 'quote approval requires biometric (§15)');
      await must(boss, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
    } else expect(quote.status === 'approved', `quote approved (${quote.status} ${JSON.stringify(quote.blockReasons)})`);
    const sent = await must(boss, 'POST', `/quotes/${quote.id}/send`);
    const token = sent.approvalLink.split('/q/')[1];
    await must(boss, 'POST', `/public/quotes/${token}/accept`, { optionNo: 1, approverName: 'Deniz Yılmaz', poNumber: `PO-${RUN}` }, { auth: false });
    const contract = await must(boss, 'POST', `/projects/${projectId}/contracts`, { supplierId: moda, serviceItemIds: [acc.id, hall.id], template: 'agency' });
    // the request carried no billing info → the compared contract is NOT clean (empty billing field)
    const cmp = await must(boss, 'POST', `/contracts/${contract.id}/compare`);
    expect(cmp.status === 'diff_pending' && cmp.diff.some((d) => d.field === 'billingInfo'), `contract blocked by missing billing info (${cmp.status})`);
    detail = await must(boss, 'GET', `/projects/${projectId}`);
    projectCode = detail.project.code;
    ids.acc = acc.id;
    ids.hall = hall.id;
    ids.moda = moda;
    ids.contract = contract.id;
    expect(projectCode.endsWith('-MODASAHILOTEL'), `code venue segment from the selected hotel (${projectCode})`);
    console.log(`   project ${projectCode} (${projectId})`);
  });

  const ops = await newPage(browser, 'ops');
  await step('5′ · Billing info fixed in the Overview → contract clean → admin approval (dev biometric) → sign (UI)', async () => {
    await login(ops, 'ops@demo.test');
    await openTab(ops, projectId, '');
    const info = ops.locator('.card', { hasText: 'Proje bilgileri' }).first();
    await info.getByText('Fatura bilgisi eksik').waitFor();
    await shot(ops, 'step5-overview-billing-missing', true);
    await info.getByRole('button', { name: 'Düzelt' }).click();
    await info.getByLabel('Fatura bilgisi').fill('Deniz Lojistik A.Ş., Kadıköy VD 9876543210, Moda Cad. 1 İstanbul');
    await info.getByRole('button', { name: 'Kaydet' }).click();
    await info.getByText('Kadıköy VD 9876543210').waitFor();
    expect(!(await info.getByText('Fatura bilgisi eksik').count()), 'billing warning gone');
    expect(projectCode.endsWith('-MODASAHILOTEL'), 'code with venue segment');
    await info.locator('.mono', { hasText: projectCode }).waitFor();

    await openTab(ops, projectId, 'contracts');
    const contract = ops.locator('.card', { hasText: /v\d+/ }).filter({ has: ops.getByRole('button', { name: 'Teklifle karşılaştır' }) }).first();
    const [resp] = await Promise.all([
      ops.waitForResponse((r) => r.request().method() === 'POST' && /\/contracts\/[^/]+\/compare$/.test(r.url())),
      contract.getByRole('button', { name: 'Teklifle karşılaştır' }).click(),
    ]);
    const con = await resp.json();
    expect(con.status === 'clean' && con.fields.billingInfo?.includes('Kadıköy VD'), `contract clean after the billing fix (${con.status})`);
    if (con.conditionRiskEur > 0) await adminDecide(admin, `${projectCode}: karşılıklı koşul riski`);
    await adminDecide(admin, new RegExp(`${projectCode}: .*sözleşmesi temiz`), { shotName: 'step5-inbox-contract' });
    await openTab(boss, projectId, 'contracts');
    const card = boss.locator('.card').filter({ hasText: 'Onaylandı' }).first();
    await card.getByRole('button', { name: /İmzala/ }).click();
    await card.locator('input[type=file]').setInputFiles({ name: 'sozlesme-imzali.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
    await card.locator('.subcard').getByRole('button', { name: /İmzala/ }).click();
    await boss.locator('.card').filter({ hasText: 'Kilitli' }).first().waitFor();
  });

  let roomingLink = '';
  await step('6a · Ops: calendar tasks after signing, program document, rooming link', async () => {
    await openTab(ops, projectId, 'operations');
    const cal = ops.locator('.card', { hasText: 'Görev takvimi' }).first();
    await cal.locator('.cal__task').first().waitFor();
    const tasks = await cal.locator('.cal__task').allInnerTexts();
    console.log(`   ${tasks.length} calendar tasks`);
    expect(tasks.some((x) => /Rooming list/i.test(x)), 'rooming list task generated on signature');
    expect(tasks.length >= 4, 'operations calendar has the contract-derived tasks');
    await shot(ops, 'step6-ops-calendar', true);

    // event program generated from the items / dates
    await openTab(ops, projectId, '');
    await ops.locator('#docgen-kind').selectOption('program');
    await ops.getByRole('button', { name: 'Belge üret' }).click();
    await ops.getByText(/Program v\d+ üretildi/).first().waitFor();
    await shot(ops, 'step6-overview-program', true);

    await openTab(ops, projectId, 'operations');
    await ops.getByRole('button', { name: 'Rooming formu linki oluştur' }).click();
    roomingLink = await ops.locator('.copy-link__url').first().innerText();
    expect(/\/r\/[\w-]+$/.test(roomingLink), `rooming link (${roomingLink})`);
  });

  await step('6b · Guests fill /r/<token> with explicit KVKK consent', async () => {
    const guest = await newPage(browser, 'guest', true);
    await guest.goto(roomingLink);
    await guest.locator('#g-name-0').waitFor();
    expect(!(await guest.locator('#g-consent-0').isChecked()), 'consent unticked by default');
    await guest.locator('#g-name-0').fill('Zeynep Kaya');
    await guest.locator('#g-email-0').fill('zeynep.kaya@example.com');
    await guest.locator('#g-phone-0').fill('+90 555 111 22 33');
    await guest.locator('#g-consent-0').check();
    await guest.getByRole('button', { name: 'Misafir ekle' }).click();
    await guest.locator('#g-name-1').fill('Mert Demir');
    const room = guest.locator('#g-room-1');
    if ((await room.evaluate((el) => el.tagName)) === 'SELECT') {
      const opts = await room.locator('option').allInnerTexts();
      if (opts.includes('DBL')) await room.selectOption('DBL');
    } else await room.fill('DBL');
    await shot(guest, 'step6-rooming-form', true);
    await guest.getByRole('button', { name: 'Listeyi gönder' }).click();
    await guest.getByText('2 misafir kaydedildi').waitFor();
    await shot(guest, 'step6-rooming-sent');
    await guest.context().close();
  });

  await step('6c · Guests visible: decrypted for ops / admin, masked for clerk_sales; rooming Excel', async () => {
    await openTab(ops, projectId, 'operations');
    const guests = ops.locator('.card', { hasText: 'Misafirler / rooming' }).first();
    await guests.getByText('Zeynep Kaya').waitFor();
    expect(await guests.getByText('zeynep.kaya@example.com').count(), 'ops sees the e-mail');
    const xlsx = await download(ops, () => guests.getByRole('button', { name: 'Excel (standart şablon)' }).click());
    expect(xlsx.name.endsWith('rooming-list.xlsx') && xlsx.bytes.subarray(0, 2).toString() === 'PK', `rooming Excel downloaded (${xlsx.name})`);
    await shot(ops, 'step6-guests-ops', true);

    const clerk = await newPage(browser, 'clerk');
    await login(clerk, 'clerk@demo.test');
    await openTab(clerk, projectId, 'operations');
    const cg = clerk.locator('.card', { hasText: 'Misafirler / rooming' }).first();
    await cg.getByText(/Misafir 1.*\*\*\*/).waitFor();
    const txt = await cg.innerText();
    expect(!txt.includes('Zeynep') && !txt.includes('zeynep.kaya'), 'clerk_sales sees masked guests only');
    const masked = await apiAs(clerk, 'GET', `/projects/${projectId}/guests`);
    expect(masked.json.items.every((g) => g.email === null && /\*\*\*/.test(g.fullName)), 'API returns masked guests to clerk_sales');
    await shot(clerk, 'step6-guests-clerk-masked', true);
    await clerk.context().close();
  });

  let extraLink = '';
  await step('6d · Field user (mobile): today’s project, field extra over 5.000 TL', async () => {
    // time-travel: the event day has come (the rooming form above was filled before the event; it is read-only from the start)
    await must(boss, 'PATCH', `/projects/${projectId}`, { startDate: TODAY, endDate: TOMORROW });
    projectCode = (await must(boss, 'GET', `/projects/${projectId}`)).project.code;
    const field = await newPage(browser, 'field', true);
    await login(field, 'field@demo.test');
    await field.goto(`${BASE}/saha`);
    await field.waitForLoadState('networkidle');
    const today = field.locator('section', { has: field.getByRole('heading', { name: 'Bugünkü projeler' }) });
    await today.locator('.fproj', { hasText: projectCode }).waitFor();
    const todayCodes = await today.locator('.fproj__code').allInnerTexts();
    const all = (await apiAs(field, 'GET', '/projects?outcome=won')).json.items;
    for (const code of todayCodes) {
      const p = all.find((x) => x.code === code);
      expect(p && p.startDate <= TODAY && TODAY <= (p.endDate ?? p.startDate), `${code} runs today`);
    }
    await field.getByRole('heading', { name: 'Yaklaşan (7 gün)' }).waitFor();
    await today.locator('.fproj', { hasText: projectCode }).click();
    await field.locator('#x-desc').fill('Ek coffee break (60 kişi) + ek teknik ekipman');
    await field.locator('#x-amt').fill('7.500');
    await field.getByText('Limit aşıldı').first().waitFor();
    await shot(field, 'step6-field-extra-form', true);
    await field.getByRole('button', { name: 'Kaydet ve müşteriye onay linki gönder' }).click();
    extraLink = await field.locator('.copy-link__url').first().innerText({ timeout: 15_000 });
    expect(/\/e\/[\w-]+$/.test(extraLink), `customer approval link (${extraLink})`);
    await shot(field, 'step6-field-extra-sent');
    // a second, small extra (within the limits) — the team later decides not to reflect it
    await field.locator('#x-desc').fill('Kayıp yaka kartı yenileme');
    await field.locator('#x-amt').fill('400');
    await field.getByRole('button', { name: 'Kaydet ve müşteriye onay linki gönder' }).click();
    await field.locator('.list', { hasText: 'Kayıp yaka kartı' }).waitFor();
    await field.context().close();
  });

  await step('6e · Customer approves the extra on /e/<token>; admin field_extra decision (dev biometric)', async () => {
    const cust = await newPage(browser, 'customer', true);
    await cust.goto(extraLink);
    await cust.getByLabel('Adınız soyadınız').fill('Deniz Yılmaz (Deniz Lojistik)');
    await shot(cust, 'step6-extra-approval');
    await cust.getByRole('button', { name: 'Onaylıyorum' }).click();
    await cust.getByText(/tarafından .* onaylandı/).waitFor();
    await cust.context().close();
    await adminDecide(admin, `${projectCode}: saha ekstrası`, { shotName: 'step6-inbox-field-extra' });
  });

  await step('6f · Ops: reflect the approved extra, do not reflect the small one (reason)', async () => {
    await openTab(ops, projectId, 'operations');
    const card = ops.locator('.card', { hasText: 'Saha ekstraları' }).first();
    const big = card.locator('tr', { hasText: 'Ek coffee break' });
    await big.getByText(/Onaylayan: Deniz Yılmaz/).waitFor();
    await big.getByRole('button', { name: 'Müşteriye yansıt' }).click();
    await big.getByText('Yansıtıldı').waitFor();
    const small = card.locator('tr', { hasText: 'Kayıp yaka kartı' });
    await small.getByRole('button', { name: 'Yansıtma' }).click();
    await small.getByPlaceholder('Yansıtmama gerekçesi (zorunlu)').fill('Acenta hatası — müşteriye yansıtılmaz');
    await small.getByRole('button', { name: 'Kaydet' }).click();
    await small.getByText('Yansıtılmadı').waitFor();
    await shot(ops, 'step6-extras-reflect', true);
  });

  const finance = await newPage(browser, 'finance');
  const INV = `MSO-${RUN}`;
  let invoiceAmount = 0;
  await step('7a · Finance: supplier invoice → payment request', async () => {
    await login(finance, 'finance@demo.test');
    const entries = (await must(finance, 'GET', `/finance/entries?projectId=${projectId}`)).items;
    invoiceAmount = Math.round(entries.filter((e) => e.kind === 'payable' && e.supplierId === ids.moda).reduce((s, e) => s + e.amount, 0) * 100) / 100;
    expect(invoiceAmount > 0, 'payables from the signed contract');
    await openTab(finance, projectId, 'finance');
    const form = finance.locator('.card', { hasText: 'Tedarikçi faturası' }).filter({ has: finance.getByLabel('Fatura no') }).first();
    await form.getByLabel('Fatura no').fill(INV);
    await form.getByLabel('Tutar', { exact: true }).fill(String(invoiceAmount));
    await form.getByLabel('Para birimi').selectOption('EUR');
    await form.getByLabel('KDV tutarı').fill(String(Math.round(invoiceAmount * 12) / 100));
    for (const cb of await form.locator('fieldset input[type=checkbox]').all()) await cb.check();
    await form.getByRole('button', { name: 'Kaydet' }).click();
    await form.locator('.callout').first().waitFor();
    const row = finance.locator('tr', { hasText: INV });
    await row.waitFor();
    await row.getByRole('button', { name: 'Ödeme talebi oluştur' }).click();
    await row.getByText('Onay bekliyor').waitFor();
    // a separately billed supplier commission is reconciled here when the supplier has one
    const comm = finance.locator('tr', { hasText: 'Komisyon' }).filter({ has: finance.getByRole('button', { name: 'Mutabakat yap' }) });
    if (await comm.count()) {
      await comm.first().getByRole('button', { name: 'Mutabakat yap' }).click();
      const open = finance.locator('tr', { has: finance.getByPlaceholder('Komisyon fatura no') }).first();
      await open.getByPlaceholder('Komisyon fatura no').fill(`KOM-${RUN}`);
      await open.getByRole('button', { name: 'Kaydet' }).click();
      await finance.getByText('Mutabakat tamam').first().waitFor();
      console.log('   commission reconciled');
    }
    await shot(finance, 'step7-finance-invoice-requested', true);
  });

  await step('7b · Admin approves the payment (dev biometric); finance marks it paid', async () => {
    await adminDecide(admin, `${projectCode}: ödeme onayı`, { shotName: 'step7-inbox-payment' });
    await openTab(finance, projectId, 'finance');
    const row = finance.locator('tr', { hasText: INV });
    await row.getByText('Onaylandı').waitFor();
    await row.getByRole('button', { name: 'Ödendi olarak işaretle' }).click();
    await row.getByPlaceholder('Banka işlem referansı').fill(`EFT-${RUN}`);
    await row.getByRole('button', { name: 'Kaydet' }).click();
    await row.getByText('Ödendi').waitFor();
  });

  const csv = (lines) => Buffer.from(['Tarih;Açıklama;Tutar;Döviz;Karşı Taraf', ...lines].join('\n'), 'utf8');
  await step('7c · Finance page: bank CSV import auto-matches the payment; Mikro export', async () => {
    await finance.goto(`${BASE}/finans`);
    await finance.getByRole('heading', { name: 'Finans', exact: true }).waitFor();
    const bank = finance.locator('.card', { hasText: 'Banka ekstresi' }).first();
    await uploadFile(bank, 'Ekstre yükle (CSV / XLSX)', { name: `ekstre-${RUN}.csv`, mimeType: 'text/csv', buffer: csv([`${dmy(TODAY)};EFT ${INV} Moda Sahil Otel odeme;-${trNum(invoiceAmount)};EUR;Moda Sahil Otel`]) });
    const summary = bank.locator('.stats');
    await summary.waitFor();
    const matched = Number(await summary.locator('.stat', { hasText: 'Eşleşti' }).locator('.stat__value').innerText());
    expect(matched >= 1, 'outgoing payment matched automatically');
    await bank.getByRole('cell', { name: new RegExp(INV) }).first().waitFor();
    const dl = await download(finance, () => finance.getByRole('button', { name: 'Excel indir' }).click());
    expect(dl.name.startsWith('mikro-aktarim') && dl.bytes.subarray(0, 2).toString() === 'PK', `Mikro export (${dl.name})`);
    await shot(finance, 'step7-finance-page', true);
  });

  const SF = `SF-${RUN}`;
  await step('7d · Customer invoice draft + invoice number from Mikro; incoming payment matched', async () => {
    await openTab(finance, projectId, 'finance');
    await finance.getByRole('button', { name: 'Müşteri faturası taslağı üret' }).click();
    await finance.getByText(/Müşteri faturası taslağı v\d+/).first().waitFor();
    const form = finance.locator('form[aria-label="Müşteri faturası (Mikro’da kesilen)"]');
    await form.getByLabel('Fatura no').fill(SF);
    const amount = Number(await form.getByLabel('Tutar (matrah)').inputValue());
    expect(amount > 0, 'invoice amount prefilled from the accepted option');
    await form.getByRole('button', { name: 'Fatura numarasını kaydet' }).click();
    await finance.locator('tr', { hasText: SF }).waitFor();
    await shot(finance, 'step7-customer-invoice', true);
    await finance.goto(`${BASE}/finans`);
    const bank = finance.locator('.card', { hasText: 'Banka ekstresi' }).first();
    await bank.locator('table, .muted').first().waitFor();
    await uploadFile(bank, 'Ekstre yükle (CSV / XLSX)', { name: `tahsilat-${RUN}.csv`, mimeType: 'text/csv', buffer: csv([`${dmy(TODAY)};Gelen havale ${SF} ${projectCode};${trNum(amount)};EUR;Deniz Lojistik`]) });
    await bank.locator('.stats').waitFor();
    const matched = Number(await bank.locator('.stat', { hasText: 'Eşleşti' }).locator('.stat__value').innerText());
    if (matched < 1) {
      // low confidence → manual match (correction is learning data)
      const row = bank.locator('tr', { hasText: SF }).first();
      const sel = row.locator('select');
      const opt = (await sel.locator('option').allInnerTexts()).find((o) => o.includes(SF));
      await sel.selectOption({ label: opt });
      await row.getByRole('button', { name: 'Eşleştir' }).click();
      await row.getByText('Eşleşti').waitFor();
      console.log('   incoming payment matched manually');
    }
  });

  let surveyLink = '';
  let suggestions = 0;
  await step('8a · Admin: closing check → close with lessons learned → survey link; realized P&L', async () => {
    await openTab(boss, projectId, 'closing');
    const check = boss.locator('.card', { hasText: 'Kapanış kontrolü' }).first();
    await check.locator('.checklist__item').first().waitFor();
    const missing = await check.locator('.checklist__item.is-missing').allInnerTexts();
    expect(!missing.length, `closing checklist complete (missing: ${missing.join(' | ')})`);
    await shot(boss, 'step8-closing-check', true);
    await boss.getByLabel('Bu projede neyi geç öğrendik?').fill('Teknik ekipman ihtiyacını sahada geç öğrendik; misafir listesinin son tarihi müşteriyle baştan netleşmeliydi.');
    const [closeResp] = await Promise.all([
      boss.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${projectId}/close`), { timeout: 20_000 }),
      boss.getByRole('button', { name: 'Projeyi kapat' }).click(),
    ]);
    const closed = await closeResp.json();
    suggestions = closed.effects.filter((x) => x.startsWith('checklist_question_suggested')).length;
    console.log(`   closed; effects: ${closed.effects.map((x) => x.split(':')[0]).join(', ')}`);
    surveyLink = await boss.locator('.copy-link__url').first().innerText({ timeout: 20_000 });
    expect(/\/survey\/[\w-]+$/.test(surveyLink), `survey link (${surveyLink})`);
    if (suggestions) await boss.getByText(/kontrol listesi önerisi/).first().waitFor();
    else console.log('   (no new checklist question — the mock AI suggestions already exist from an earlier run)');
    await boss.locator('#docgen-kind').selectOption('pnl');
    await boss.getByRole('button', { name: 'Belge üret' }).click();
    await boss.getByText(/Kâr-zarar tablosu v\d+ üretildi/).first().waitFor();
    const pnl = (await must(boss, 'GET', `/projects/${projectId}/documents`)).items.find((d) => d.kind === 'pnl');
    expect(pnl.content.realized?.actual?.costEur > 0 && 'markup' in pnl.content.realized.actual, 'realized P&L (plan vs actual, margin & markup)');
    await shot(boss, 'step8-closed', true);
  });

  await step('8b · Admin decides the checklist suggestion; customer submits the survey', async () => {
    if (suggestions) await adminDecide(admin, 'Kontrol listesine yeni soru', { shotName: 'step8-inbox-checklist' });
    const cust = await newPage(browser, 'survey', true);
    await cust.goto(surveyLink);
    await cust.getByRole('radiogroup').first().waitFor();
    for (const group of await cust.getByRole('radiogroup').all()) await group.getByRole('radio', { name: '5 / 5' }).click();
    const text = cust.locator('textarea').first();
    if (await text.count()) await text.fill('Her şey çok iyiydi, coffee break daha erken olabilirdi.');
    await shot(cust, 'step8-survey', true);
    await cust.getByRole('button', { name: 'Gönder' }).click();
    await cust.getByText('Teşekkür ederiz!').waitFor();
    await cust.context().close();
  });

  await step('Reports & admin: weekly report, unreflected totals, markup tier edit, delegation create / end', async () => {
    await boss.goto(`${BASE}/rapor`);
    await boss.waitForLoadState('networkidle');
    const report = await boss.locator('main').innerText();
    expect(report.includes('Haftalık gelişim raporu') && report.includes('Kazanılan'), 'weekly report renders');
    await shot(boss, 'report-weekly', true);

    await boss.goto(`${BASE}/finans`);
    const unref = boss.locator('.card', { hasText: 'Yansıtılmayan fiyat farkları' }).first();
    await unref.getByText(projectCode).waitFor();
    await shot(boss, 'admin-finance-unreflected', true);

    const before = await must(boss, 'GET', '/rules');
    await boss.goto(`${BASE}/yonetim/kurallar`);
    const tier = boss.locator('#tier-m-0');
    await tier.waitFor();
    const old = Number(await tier.inputValue());
    await tier.fill(String(old + 1));
    await boss.getByRole('button', { name: 'Kaydet' }).click();
    await boss.getByText('Kurallar kaydedildi').first().waitFor();
    const after = await must(boss, 'GET', '/rules');
    expect(Math.abs(after.markupTiers[0].markup - (before.markupTiers[0].markup + 0.01)) < 1e-9, 'markup tier saved');
    await shot(boss, 'admin-rules');
    await must(boss, 'PATCH', '/rules', { markupTiers: before.markupTiers, reason: 'e2e: geri al' }); // restore for later runs

    await boss.goto(`${BASE}/yonetim/vekalet`);
    const form = boss.locator('.card', { hasText: 'Yeni vekâlet' });
    await form.getByLabel('Vekil').selectOption({ index: 1 });
    const dt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await form.getByLabel('Başlangıç').fill(dt(new Date(Date.now() - 3_600_000)));
    await form.getByLabel('Bitiş').fill(dt(new Date(Date.now() + 3 * 86_400_000)));
    await form.getByRole('button', { name: 'Oluştur' }).click();
    const list = boss.locator('.card', { hasText: 'Vekâlet' }).last();
    const row = list.locator('tbody tr').filter({ hasText: 'Aktif' }).first();
    await row.waitFor();
    await shot(boss, 'admin-delegation-active', true);
    await row.getByRole('button', { name: 'Sonlandır' }).click();
    await list.locator('tbody tr').first().getByText('Bitti').waitFor();
    await shot(boss, 'admin-delegation-ended', true);
  });

  await step('Mobile tab bar: "Yeni talep" for sales / admin, finance tab for finance', async () => {
    await admin.goto(`${BASE}/`);
    const bar = admin.locator('nav.tabbar');
    await bar.getByRole('link', { name: 'Yeni talep' }).waitFor();
    await shot(admin, 'mobile-tabbar-admin');
    await bar.getByRole('button', { name: 'Ayarlar' }).click();
    await admin.getByRole('dialog').getByRole('link', { name: 'Finans' }).waitFor();
    await shot(admin, 'mobile-profile-sheet');
    await admin.getByRole('dialog').getByRole('link', { name: 'Finans' }).click();
    await admin.getByRole('heading', { name: 'Finans', exact: true }).waitFor();
    await shot(admin, 'mobile-finance-page', true);
    await bar.getByRole('link', { name: 'Yeni talep' }).click();
    await admin.locator('#intake-body').waitFor();
    const fin = await newPage(browser, 'finance-mobile', true);
    await login(fin, 'finance@demo.test');
    const fbar = fin.locator('nav.tabbar');
    await fbar.getByRole('link', { name: 'Finans' }).waitFor();
    expect(!(await fbar.getByRole('link', { name: 'Yeni talep' }).count()), 'no "Yeni talep" for finance');
    await fin.context().close();
  });
} catch (e) {
  problems.push(`[${currentStep}] FAILED: ${e.message.split('\n').slice(0, 4).join(' | ')}`);
  for (const [n, p] of [['boss', boss], ['admin', admin]]) await p.screenshot({ path: `${SHOTS}/FAILED-${n}.png`, fullPage: true }).catch(() => {});
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p !== boss && p !== admin) await p.screenshot({ path: `${SHOTS}/FAILED-${Math.random().toString(36).slice(2, 6)}.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nALL STEPS PASSED');
