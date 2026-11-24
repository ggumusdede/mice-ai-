// Q5 follow-up: dated FX rate store (fx_rates.rate_type) fed by the TCMB daily XML (today.xml / kurlar/YYYYMM/DDMMYYYY.xml),
// manual entry or CSV upload. These rates value movements made WITHOUT conversion at their value date (rule
// fxRateTypeForReporting); they never change the internal system rate (currentFx reads rate_type IS NULL only).
// Network: services/integrations-http.ts (tests inject a mock with setIntegrationFetch — no real call in tests).
import type { FxRate, FxRateType } from '@mice/shared';
import { FX_LOOKBACK_DAYS, FX_RATE_TYPES, parseTcmbXml, parseTrNumber, tcmbToEurRates, tcmbUrl } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, forbidden } from '../errors.js';
import type { Row } from '../lib/mappers.js';
import { httpCall } from './integrations-http.js';

function assertFxWriter(ctx: Ctx): void {
  if (ctx.actor.type === 'system' && !ctx.user) return; // scheduled TCMB import (scripts/import-tcmb.ts)
  const u = requireUser(ctx);
  if (ctx.actor.type !== 'user' || !['admin', 'finance'].includes(u.role)) throw forbidden('Kur kaydını yönetici veya finans girer', 'FORBIDDEN');
}

const mapRate = (r: Row): FxRate => ({
  id: r.id, currency: r.currency, rate: Number(r.rate), rateType: r.rate_type ?? null, source: r.source, rateDate: String(r.rate_date).slice(0, 10),
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});

export async function listFxRates(ctx: Ctx, f: { from?: string; to?: string; rateType?: FxRateType }): Promise<FxRate[]> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM fx_rates WHERE ($1::date IS NULL OR rate_date >= $1) AND ($2::date IS NULL OR rate_date <= $2) AND ($3::text IS NULL OR rate_type = $3)
      ORDER BY rate_date DESC, currency, rate_type NULLS FIRST LIMIT 2000`, [f.from ?? null, f.to ?? null, f.rateType ?? null]);
  return rows.map(mapRate);
}

async function upsertTyped(ctx: Ctx, rows: { currency: string; rateType: FxRateType; rate: number; rateDate: string }[], source: string): Promise<number> {
  let n = 0;
  for (const r of rows) {
    if (!['TRY', 'USD', 'GBP'].includes(r.currency) || !(r.rate > 0) || !FX_RATE_TYPES.includes(r.rateType)) continue;
    // a published rate is a fact: the first stored value for (currency, type, date) is kept (append-only spirit, no silent overwrite)
    const ins = await ctx.db.query(
      `INSERT INTO fx_rates (tenant_id, currency, rate, source, rate_date, rate_type, created_by) VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, currency, rate_type, rate_date) WHERE rate_type IS NOT NULL DO NOTHING RETURNING id`,
      [r.currency, r.rate, source, r.rateDate, r.rateType, ctx.user?.id ?? null]);
    n += ins.rowCount ?? 0;
  }
  return n;
}

/** Imports one TCMB bulletin (date omitted = today.xml). `xml` lets a caller (or test) pass the bulletin directly. */
export async function importTcmbRates(ctx: Ctx, input: { date?: string; xml?: string } = {}): Promise<{ date: string; inserted: number; rows: number; url: string | null }> {
  assertFxWriter(ctx);
  let xml = input.xml;
  const url = xml ? null : tcmbUrl(input.date);
  if (!xml) xml = await fetchTcmbXml(input.date);
  let daily;

  try {
    daily = parseTcmbXml(xml);
  } catch (e) {
    throw badRequest(`TCMB XML okunamadı: ${(e as Error).message}`, undefined, 'TCMB_PARSE');
  }
  const rows = tcmbToEurRates(daily);
  const inserted = await upsertTyped(ctx, rows, `TCMB ${daily.date}`);
  return { date: daily.date, inserted, rows: rows.length, url };
}

/** Fetches one TCMB bulletin (network via integrations-http — mocked in tests). */
export async function fetchTcmbXml(date?: string): Promise<string> {
  const res = await httpCall(tcmbUrl(date), { method: 'GET', headers: { accept: 'application/xml' } }).catch((e) => {
    throw badRequest(`TCMB kurları alınamadı (${(e as Error).message}) — kurları elle veya CSV ile girin`, undefined, 'TCMB_UNAVAILABLE');
  });
  // TCMB answers 404 for weekends / holidays (no bulletin): nothing is stored, the value-date lookup falls back to the previous day
  if (res.status === 404) throw badRequest(`${date ?? 'bugün'} için TCMB bülteni yok (hafta sonu / tatil) — önceki iş gününün kuru kullanılır`, undefined, 'TCMB_NO_BULLETIN');
  if (res.status !== 200) throw badRequest(`TCMB yanıtı ${res.status}`, undefined, 'TCMB_UNAVAILABLE');
  return res.text;
}

/** Manual entry / CSV ("tarih;para birimi;tür;kur" — kur = 1 EUR kaç <para birimi>; TL için EUR/TRY). */
export async function addFxRates(ctx: Ctx, input: { rows?: { rateDate: string; currency: string; rateType?: FxRateType; rate: number }[]; csv?: string; source?: string }): Promise<{ inserted: number; rejected: { line: number; reason: string }[] }> {
  assertFxWriter(ctx);
  const rules = await ctx.rules();
  const rejected: { line: number; reason: string }[] = [];
  const rows: { currency: string; rateType: FxRateType; rate: number; rateDate: string }[] = [];
  const push = (line: number, d: string, cur: string, type: string | undefined, rate: number | null) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : /^\d{2}\.\d{2}\.\d{4}$/.test(d) ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : null;
    const c = cur.trim().toUpperCase().replace(/^TL$/, 'TRY');
    const t = (type?.trim() || rules.fxRateTypeForReporting) as FxRateType;
    if (!iso) return rejected.push({ line, reason: 'tarih okunamadı' });
    if (!['TRY', 'USD', 'GBP'].includes(c)) return rejected.push({ line, reason: `para birimi ${c} (TRY / USD / GBP; 1 EUR = kur)` });
    if (!FX_RATE_TYPES.includes(t)) return rejected.push({ line, reason: `kur türü ${t}` });
    if (rate == null || !(rate > 0)) return rejected.push({ line, reason: 'kur pozitif sayı olmalı' });
    rows.push({ rateDate: iso, currency: c, rateType: t, rate });
  };
  (input.rows ?? []).forEach((r, i) => push(i + 1, r.rateDate, r.currency, r.rateType, Number(r.rate)));
  if (input.csv) {
    const lines = input.csv.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => {
      const cells = l.split(/[;\t]/);
      if (i === 0 && /tarih|date/i.test(cells[0])) return; // header
      push(i + 1, cells[0] ?? '', cells[1] ?? '', cells[2], parseTrNumber(cells[3] ?? ''));
    });
  }
  if (rows.length > 5000) throw badRequest('En fazla 5000 kur satırı', undefined, 'TOO_MANY_ROWS');
  const inserted = await upsertTyped(ctx, rows, input.source?.slice(0, 80) || 'elle giriş');
  return { inserted, rejected };
}

/** Typed rates (one type) around the given value dates — input for domain fillRatesFromTable. */
export async function ratesTable(ctx: Ctx, rateType: FxRateType, dates: string[]): Promise<{ currency: string; rateDate: string; rate: number }[]> {
  const ds = dates.filter(Boolean).sort();
  if (!ds.length) return [];
  const { rows } = await ctx.db.query(
    `SELECT currency, rate_date, rate FROM fx_rates WHERE rate_type = $1 AND rate_date BETWEEN $2::date - $4::int AND $3::date`,
    [rateType, ds[0], ds[ds.length - 1], FX_LOOKBACK_DAYS]);
  return rows.map((r) => ({ currency: r.currency, rateDate: String(r.rate_date).slice(0, 10), rate: Number(r.rate) }));
}
