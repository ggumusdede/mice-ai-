// v0.5 S-19 (ana çatı 7, ürün sahibi kararı 22.11.2026): every agency chooses its base currency (TL / EUR / USD) and may change it;
// the change applies to NEW projects, each project is fixed to the base currency it was created with, agency-level reports convert
// with the rate source shown. Pure helpers: the stored rate convention stays "1 EUR = rates[c] c" (fx_rates); a project computes in
// its base B with the same table rebased on B ("1 B = rebased[c] c"). Never guesses: an unknown rate throws / returns null.
import type { BaseCurrency, Currency } from '@mice/shared';
import { BASE_CURRENCIES } from '@mice/shared';
import { round2 } from './pricing.js';

export function isBaseCurrency(c: unknown): c is BaseCurrency {
  return typeof c === 'string' && (BASE_CURRENCIES as readonly string[]).includes(c);
}

/** 1 EUR = x `currency` from an EUR-based table (EUR → 1). null = unknown. */
export function eurRateOf(currency: string, eurRates: Record<string, number>): number | null {
  const c = currency.toUpperCase();
  if (c === 'EUR') return 1;
  const r = eurRates[c];
  return r != null && Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Rebases an EUR-based table (1 EUR = r[c]) on `base`: result[c] = 1 base = x c, result[base] = 1, result.EUR = 1 / r[base].
 * Currencies without a rate are left out. Throws when the base itself has no rate (no silent EUR fallback).
 */
export function rebaseRates(eurRates: Record<string, number>, base: Currency | string): Record<string, number> {
  const b = base.toUpperCase();
  const rb = eurRateOf(b, eurRates);
  if (rb == null) throw new Error(`Ana para birimi için kur yok: ${b}`);
  const out: Record<string, number> = { EUR: 1 / rb };
  for (const [c, r] of Object.entries(eurRates)) {
    const rc = eurRateOf(c, eurRates);
    if (rc != null) out[c.toUpperCase()] = rc / rb;
  }
  out[b] = 1;
  return out;
}

/** 1 `from` = x `to` from an EUR-based table; null when a rate is missing. */
export function crossRate(from: string, to: string, eurRates: Record<string, number>): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const rf = eurRateOf(from, eurRates);
  const rt = eurRateOf(to, eurRates);
  return rf != null && rt != null ? rt / rf : null;
}

/** Converts `amount` from → to with an EUR-based table (2-decimal rounding); null when a rate is missing. */
export function convertAmount(amount: number, from: string, to: string, eurRates: Record<string, number>): number | null {
  const k = crossRate(from, to, eurRates);
  return k == null ? null : round2(amount * k);
}

/** Agency-level report line: amounts of projects with different base currencies summed in the agency's CURRENT base currency.
 *  Returns the total, the per-currency subtotals and the projects whose currency had no rate (left out, listed — never guessed). */
export function sumInCurrency(
  parts: { amount: number; currency: string }[], target: string, eurRates: Record<string, number>,
): { total: number; byCurrency: Record<string, number>; unconverted: Record<string, number> } {
  const byCurrency: Record<string, number> = {};
  const unconverted: Record<string, number> = {};
  let total = 0;
  for (const p of parts) {
    if (!Number.isFinite(p.amount)) continue;
    const c = p.currency.toUpperCase();
    byCurrency[c] = round2((byCurrency[c] ?? 0) + p.amount);
    const k = crossRate(c, target, eurRates);
    if (k == null) unconverted[c] = round2((unconverted[c] ?? 0) + p.amount);
    else total += p.amount * k;
  }
  return { total: round2(total), byCurrency, unconverted };
}
