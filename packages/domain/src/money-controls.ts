// v0.5 S-06 "Kapora önce" + S-07 teklif kur politikası. Pure rules; thresholds come from the `rules` table (ana çatı 8).
import type { TenantRules } from '@mice/shared';
import { round2 } from './pricing.js';

// ------------------------------------------------------------------ S-06 kapora önce
export interface DepositFirstInput {
  /** customer deposit rate from the customer's rules (0 = no deposit agreed → rule does not apply) */
  depositRate: number;
  /** expected deposit in base currency (depositRate × customer total); null = unknown total */
  expectedDeposit: number | null;
  /** collected from the customer so far (base currency) */
  collected: number;
  mode: TenantRules['depositFirstMode'];
}
export interface DepositFirstResult { status: 'ok' | 'warn' | 'block'; message: string | null; missing: number | null }

/** A supplier prepayment requested before the customer deposit is collected: warn (reason + Face ID exception) or block. */
export function depositFirstCheck(i: DepositFirstInput): DepositFirstResult {
  if (!(i.depositRate > 0)) return { status: 'ok', message: null, missing: null };
  const expected = i.expectedDeposit != null && i.expectedDeposit > 0 ? i.expectedDeposit : null;
  // tolerance: 1% (bank charges / rounding)
  const collectedEnough = expected != null ? i.collected >= expected * 0.99 : i.collected > 0;
  if (collectedEnough) return { status: 'ok', message: null, missing: null };
  const missing = expected != null ? round2(Math.max(0, expected - i.collected)) : null;
  const status = i.mode === 'block' ? 'block' : 'warn';
  const message = `Müşteri kaporası (%${Math.round(i.depositRate * 100)}) henüz tahsil edilmedi${missing != null ? ` — eksik ${missing}` : ''}: tedarikçiye ön ödeme ${status === 'block' ? 'acenta kuralıyla engelli' : 'ancak gerekçe + Face ID istisnasıyla'}.`;
  return { status, message, missing };
}

// ------------------------------------------------------------------ S-07 kur politikası
export interface FxPolicyInput {
  baseCurrency: string;
  quoteCurrency: string;
  /** market rate 1 base = x quote currency */
  marketRate: number;
  rateSource?: string | null;
  rateDate?: string | null;
  validUntil?: string | null;
  bufferPct?: number | null;
}
export interface ResolvedFxPolicy {
  rateSource: string; rateDate: string; validUntil: string; bufferPct: number; marketRate: number;
  /** customer rate: market × (1 + buffer) */
  customerRate: number;
}

/**
 * Fills and validates the mandatory quote FX policy. Defaults: source/date of the current rate, validity = option date, buffer =
 * rule default when the quote currency differs from the base currency (no buffer otherwise). Returns errors instead of throwing.
 */
export function resolveFxPolicy(i: FxPolicyInput, defaults: { rateSource: string; rateDate: string; validUntil: string; rules: Pick<TenantRules, 'quoteFxBufferDefault' | 'quoteFxBufferMax'> }): { policy: ResolvedFxPolicy; errors: string[] } {
  const errors: string[] = [];
  const same = i.baseCurrency.toUpperCase() === i.quoteCurrency.toUpperCase();
  let buffer = i.bufferPct ?? (same ? 0 : defaults.rules.quoteFxBufferDefault);
  if (!Number.isFinite(buffer) || buffer < 0) { errors.push('Kur payı negatif olamaz'); buffer = 0; }
  if (buffer > defaults.rules.quoteFxBufferMax + 1e-9) errors.push(`Kur payı en fazla %${Math.round(defaults.rules.quoteFxBufferMax * 100)} olabilir`);
  if (same) buffer = 0; // teklif ana para biriminde: kur riski yok
  const validUntil = (i.validUntil ?? defaults.validUntil).slice(0, 10);
  const rateDate = (i.rateDate ?? defaults.rateDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) errors.push('Kur geçerlilik tarihi zorunlu');
  else if (validUntil < rateDate) errors.push('Kur geçerlilik tarihi kur tarihinden önce olamaz');
  const rateSource = (i.rateSource ?? '').trim() || defaults.rateSource;
  if (!(i.marketRate > 0)) errors.push('Kur bulunamadı');
  return {
    policy: { rateSource, rateDate, validUntil, bufferPct: Math.round(buffer * 10000) / 10000, marketRate: i.marketRate, customerRate: Math.round(i.marketRate * (1 + buffer) * 1e6) / 1e6 },
    errors,
  };
}

/** Internal FX buffer of an option in base currency (sale × buffer): shown as its own line in the margin / markup breakdown. */
export function fxBufferAmount(saleBase: number, bufferPct: number): number {
  return round2(saleBase * Math.max(0, bufferPct || 0));
}
