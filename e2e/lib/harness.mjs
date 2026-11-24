// Shared Playwright harness for the browser scenarios under e2e/scenarios/ (same conventions as e2e/steps0-5.mjs and
// e2e/steps6-8.mjs, which stay self-contained). Each scenario is its own process:
//
//   import { scenario, step, expect, ... } from '../lib/harness.mjs';
//   await scenario('Revizyon döngüsü', async (h) => { await step('…', async () => { … }); });
//
// Against already running servers (api :3001 with AI_PROVIDER=mock, web :5173). Env: BASE_URL, SHOTS, HEADED=1.
// Exit codes: 0 pass · 1 fail · 3 skipped (precondition missing, e.g. no INBOUND_EMAIL_SECRET) — e2e/run-all.mjs reads them.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
export const SHOTS = resolve(process.env.SHOTS ?? new URL('../shots', import.meta.url).pathname);
export const PASSWORD = 'demo1234';
export const RUN = Date.now().toString(36).slice(-5).toUpperCase();
mkdirSync(SHOTS, { recursive: true });

export const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const TODAY = ymd(new Date());
export const TOMORROW = ymd(new Date(Date.now() + 86_400_000));
export const dmy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
export const trNum = (n) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- state (one scenario per process)
export const problems = [];
export const notes = [];
let currentStep = 'setup';
let browser = null;
let prefix = 'scenario';
/** Expected HTTP errors of the step under test: [{ method?, url: RegExp, status }] — logged, not counted as problems. */
const allowed = [];
/** console.error lines per page label (accessibility / visual scenarios assert on them) */
export const consoleErrors = [];

export class Skip extends Error {}
export function skip(reason) {
  throw new Skip(reason);
}

/** Mark an HTTP error answer as expected (e.g. 409 "belge eski" when the test clicks "Müşteriye gönder"). */
export function allowHttp(url, status, method) {
  const rule = { url, status, method };
  allowed.push(rule);
  return () => allowed.splice(allowed.indexOf(rule), 1);
}

function isAllowed(method, url, status) {
  return allowed.some((a) => a.status === status && a.url.test(url) && (!a.method || a.method === method));
}

export function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${currentStep}] ${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // failed requests are reported by the response handler below (with their status / body)
    if (/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(text)) return;
    consoleErrors.push(`[${currentStep}] ${label}: ${text.slice(0, 300)}`);
  });
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400) return;
    const method = r.request().method();
    const body = (await r.text().catch(() => '')).slice(0, 300);
    const line = `[${currentStep}] ${label} ${method} ${url.replace(BASE, '')} → ${r.status()} ${body}`;
    if (isAllowed(method, url, r.status())) console.log('   (expected) ' + line);
    else if (r.status() >= 500 || r.status() === 404) problems.push(line);
    else console.log('   (4xx) ' + line);
  });
}

export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true };
export const DESKTOP = { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true };

export async function newPage(label, mobile = false, extra = {}) {
  const ctx = await browser.newContext({ timezoneId: process.env.TZ || 'Europe/Istanbul', ...(mobile ? MOBILE : DESKTOP), ...extra });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  watch(page, label);
  return page;
}

export async function login(page, email) {
  await page.goto(`${BASE}/giris`);
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/giris'));
}

/** New context + login in one go. */
export async function as(email, label = email.split('@')[0], mobile = false, extra) {
  const page = await newPage(label, mobile, extra);
  await login(page, email);
  return page;
}

export async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${prefix}-${name}.png`, fullPage });
}

export async function step(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  await fn();
  console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

export function expect(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export async function apiAs(page, method, path, body, { auth = true } = {}) {
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

export async function must(page, method, path, body, opts) {
  const r = await apiAs(page, method, path, body, opts);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

/** Plain fetch from the test process (webhooks, public endpoints) — goes straight to BASE (vite proxies /api). */
export async function http(method, path, { body, headers = {}, raw } = {}) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html / empty */ }
  return { status: r.status, json, text };
}

/** Admin inbox: open the first card matching `text`; approve via the primary action (dev biometric fallback when offered). */
export async function adminDecide(admin, text, { shotName, reason, action = 'approve' } = {}) {
  const { card, summary, sheet } = await openDecision(admin, text, { shotName });
  void card;
  if (action === 'reject') {
    await sheet.getByRole('button', { name: 'Reddet' }).click();
    await sheet.getByLabel('Ret gerekçesi').fill(reason ?? 'e2e: reddedildi');
    await sheet.locator('.sheet-actions > button').first().click();
  } else {
    const r = sheet.locator('#approve-reason');
    if (await r.count()) await r.fill(reason ?? 'Stratejik müşteri — e2e');
    await approveInSheet(sheet);
  }
  await closedSheet(sheet, summary);
  console.log(`   admin decided (${action}): ${summary}`);
  return summary;
}

export async function openDecision(page, text, { shotName } = {}) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.dcard:not(.dcard--skeleton), .allgood');
  const card = page.locator('.dcard:not(.dcard--skeleton)', { hasText: text }).first();
  await card.waitFor({ timeout: 10_000 });
  const summary = (await card.locator('.dcard__summary').innerText()).trim();
  await card.click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  if (shotName) await shot(page, shotName);
  return { card, summary, sheet };
}

/** Primary action in an open decision sheet; dev biometric fallback when WebAuthn is not available headless. */
export async function approveInSheet(sheet, { primaryIndex = 0 } = {}) {
  const dev = sheet.getByRole('button', { name: 'Geliştirici doğrulaması ile onayla' });
  if (await dev.count()) await dev.click();
  else {
    await sheet.locator('.sheet-actions > button').nth(primaryIndex).click();
    if (await dev.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await dev.click();
  }
}

export async function closedSheet(sheet, summary = '') {
  await sheet.waitFor({ state: 'detached', timeout: 15_000 }).catch(async () => {
    throw new Error(`decision "${summary}" not closed: ${(await sheet.innerText().catch(() => '')).slice(0, 400)}`);
  });
}

export async function openTab(page, projectId, tab = '') {
  await page.goto(`${BASE}/projeler/${projectId}/${tab}`);
  await page.waitForSelector('.tabs');
  await page.waitForLoadState('networkidle');
}

export async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) };
}

export async function uploadFile(scope, buttonName, file) {
  // FilePicker = hidden <input type=file> next to its button
  const picker = scope.locator('.file-picker', { has: scope.page().getByRole('button', { name: buttonName }) }).first();
  await picker.locator('input[type=file]').setInputFiles(file);
}

/** Toast text (role=status region of the Toast component) */
export async function toast(page, re, timeout = 10_000) {
  await page.locator('.toast', { hasText: re }).first().waitFor({ timeout });
}

// ---------------------------------------------------------------- runner
/**
 * Runs a scenario: launches Chromium, calls fn(), screenshots every open page on failure, prints PROBLEMS and exits
 * (0 pass / 1 fail / 3 skip). `name` is used as the screenshot prefix.
 */
export async function scenario(name, fn, { cleanup } = {}) {
  prefix = name;
  const t0 = Date.now();
  browser = await chromium.launch({ headless: !process.env.HEADED });
  let skipped = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof Skip) skipped = e.message;
    else {
      problems.push(`[${currentStep}] FAILED: ${e.message.split('\n').slice(0, 4).join(' | ')}`);
      let i = 0;
      for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: `${SHOTS}/${prefix}-FAILED-${i++}.png`, fullPage: true }).catch(() => {});
    }
  } finally {
    if (cleanup) await cleanup().catch((e) => problems.push(`[cleanup] ${e.message}`));
    await browser.close();
  }
  console.log(`\nScreenshots: ${SHOTS}/${prefix}-*.png (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (notes.length) console.log(`\nNotes (${notes.length}):\n  ${notes.join('\n  ')}`);
  if (skipped) {
    console.log(`\nSKIPPED: ${skipped}`);
    process.exit(3);
  }
  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nALL STEPS PASSED');
  process.exit(0);
}

export function getBrowser() {
  return browser;
}

/**
 * Time travel for preconditions the HTTP contract cannot express (e.g. an RFQ deadline in the past). Runs SQL as the migration
 * superuser via psql (MIGRATION_DATABASE_URL, default postgres://postgres@localhost:5432/mice). Returns null when psql is missing.
 */
export async function sql(statement) {
  const { spawnSync } = await import('node:child_process');
  const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/mice';
  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], { encoding: 'utf8' });
  if (r.error) return null;
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
}
