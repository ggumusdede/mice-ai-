// §7 Adım 2: internal currency EUR; FX source + date are always recorded.
import type { Db } from '../db/pool.js';
import { badRequest } from '../errors.js';

export interface FxSnapshot {
  /** 1 EUR = rates[currency] */
  rates: Record<string, number>;
  source: string;
  date: string;
}

export async function currentFx(db: Db): Promise<FxSnapshot> {
  const { rows } = await db.query<{ currency: string; rate: number; source: string; rate_date: string }>(
    `SELECT DISTINCT ON (currency) currency, rate, source, rate_date FROM fx_rates
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
