// §7 Adım 2: FX source + date are always recorded. Stored convention: 1 EUR = rate × currency (fx_rates).
// v0.5 S-19: a project computes in its own base currency — currentFx(db, base) returns the table rebased on that currency
// (1 base = rates[c]), so toEur()/rateFor() below convert to / from the BASE currency (legacy name kept).
import { rebaseRates } from '@mice/domain';
import type { Db } from '../db/pool.js';
import { badRequest } from '../errors.js';

export interface FxSnapshot {
  /** 1 <base> = rates[currency] (base EUR unless rebased) */
  rates: Record<string, number>;
  source: string;
  date: string;
  /** (v0.5) currency the rates are based on */
  base?: string;
  /** (v0.5) the stored EUR-based table (1 EUR = eurRates[c]) */
  eurRates?: Record<string, number>;
}

/** Rates rebased on `base` (project base currency). Missing base rate → 400 FX_RATE_MISSING. */
export async function currentFx(db: Db, base = 'EUR'): Promise<FxSnapshot> {
  const eur = await currentEurFx(db);
  if (base === 'EUR') return { ...eur, base: 'EUR', eurRates: eur.rates };
  if (!eur.rates[base]) throw badRequest(`Kur bulunamadı: ${base}`, undefined, 'FX_RATE_MISSING');
  return { rates: rebaseRates(eur.rates, base), source: eur.source, date: eur.date, base, eurRates: eur.rates };
}

/** Base currency of a project (fixed at creation; EUR for pre-v0.5 projects). */
export async function projectBase(db: Db, projectId: string | null | undefined): Promise<string> {
  if (projectId) {
    const r = (await db.query<{ base_currency: string | null }>('SELECT base_currency FROM projects WHERE id = $1', [projectId])).rows[0];
    if (r?.base_currency) return r.base_currency;
  }
  return agencyBase(db);
}

/** The agency's CURRENT base currency (new projects take it; agency-level reports convert to it). */
export async function agencyBase(db: Db): Promise<string> {
  const r = (await db.query<{ base_currency: string | null }>('SELECT base_currency FROM tenants WHERE id = app_tenant_id()')).rows[0];
  return r?.base_currency ?? 'EUR';
}

/** EUR equivalent (deprecated *_eur columns) of an amount in `currency`, with the snapshot's stored EUR table. */
export function eurEquivalent(fx: FxSnapshot, amount: number, currency: string): number {
  const t = fx.eurRates ?? fx.rates;
  const c = currency.toUpperCase();
  const r = c === 'EUR' ? 1 : t[c];
  if (!r) throw badRequest(`Kur bulunamadı: ${currency}`, undefined, 'FX_RATE_MISSING');
  return amount / r;
}

async function currentEurFx(db: Db): Promise<FxSnapshot> {
  const { rows } = await db.query<{ currency: string; rate: number; source: string; rate_date: string }>(
    `SELECT DISTINCT ON (currency) currency, rate, source, rate_date FROM fx_rates WHERE rate_type IS NULL
     ORDER BY currency, rate_date DESC, created_at DESC`,
  );
  const rates: Record<string, number> = { EUR: 1 };
  let source = 'internal';
  let date = '1970-01-01';
  for (const r of rows) {
    rates[r.currency] = Number(r.rate);
    if (r.rate_date > date) {
      date = r.rate_date;
      source = r.source;
    }
  }
  return { rates, source, date };
}

export function rateFor(fx: FxSnapshot, currency: string): number {
  const r = fx.rates[currency.toUpperCase()];
  if (!r) throw badRequest(`Kur bulunamadı: ${currency}`, undefined, 'FX_RATE_MISSING');
  return r;
}

export function toEur(fx: FxSnapshot, amount: number, currency: string): number {
  return amount / rateFor(fx, currency);
}
