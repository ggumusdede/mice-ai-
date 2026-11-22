// §7 Adım 7–8 + ürün sahibi kararı (Q5): evidence-based realized FX. The internal currency stays EUR (invariant 7); this ADDS
// realized TRY reporting. Every movement (customer / supplier invoice, collection, payment) is converted with ITS OWN actual rate
// (bank line, invoice / e-Fatura rate, payment record) — never with today's rate. A movement without an actual rate is NOT
// guessed (§3.7 "bilmiyorum"): it is listed in `missingRates` and the result is partial.
//
// Model per side (revenue = customer invoices + collections, cost = supplier invoices + payments):
//  - cash settles invoices: first the invoice it names (`settles`), otherwise FIFO by date over the side's invoices; the settled part
//    of an invoice is replaced by the cash (counted at the cash rate), the unsettled remainder is counted at the invoice's own rate;
//  - cash beyond the invoices (prepayment / unbilled payment) is counted at its own rate and flagged.
import type { Currency, FxEvidence, FxMovement, FxMovementType, FxRateSource, RealizedFx, RealizedFxReasonCode } from '@mice/shared';
import { round2 } from './pricing.js';

const EPS = 0.005;
const pos = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);

export interface MovementRates { eurRate: number | null; eurTryRate: number | null }

/** EUR → rate 1; TRY → eurRate = eurTryRate; otherwise as given (positive finite only). */
export function normalizeMovementRates(m: Pick<FxMovement, 'currency' | 'eurRate' | 'eurTryRate'>): MovementRates {
  let eurRate = pos(m.eurRate);
  let eurTryRate = pos(m.eurTryRate);
  if (m.currency === 'EUR') eurRate = 1;
  if (m.currency === 'TRY') {
    const r = eurTryRate ?? eurRate;
    eurRate = r;
    eurTryRate = r;
  }
  return { eurRate, eurTryRate };
}

/**
 * Actual rates of a movement from what the document / bank line / payment record proves:
 * an explicit EUR/TRY rate, a TL equivalent (tryAmount) and / or an EUR equivalent (eurAmount, e.g. the EUR invoice a TRY bank
 * line settles). Returns nulls for what cannot be proven.
 */
export function deriveMovementRates(input: { amount: number; currency: Currency | string; eurTryRate?: number | null; tryAmount?: number | null; eurAmount?: number | null }): MovementRates {
  const amount = pos(input.amount);
  const eurAmount = pos(input.eurAmount);
  const tryAmount = pos(input.tryAmount);
  let eurTry = pos(input.eurTryRate);
  let eurRate: number | null = null;
  if (input.currency === 'EUR') {
    eurRate = 1;
    if (eurTry == null && tryAmount != null && amount != null) eurTry = tryAmount / amount;
  } else if (input.currency === 'TRY') {
    if (eurTry == null && eurAmount != null && amount != null) eurTry = amount / eurAmount;
    eurRate = eurTry;
  } else {
    if (eurAmount != null && amount != null) eurRate = amount / eurAmount;
    if (eurTry == null && tryAmount != null && eurAmount != null) eurTry = tryAmount / eurAmount;
  }
  return { eurRate: eurRate != null ? round6(eurRate) : null, eurTryRate: eurTry != null ? round6(eurTry) : null };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 1 EUR = x `cur` at movement m (null = unknown). */
function rateOf(m: FxMovement, r: MovementRates, cur: string): number | null {
  if (cur === 'EUR') return 1;
  if (cur === 'TRY') return r.eurTryRate;
  if (cur === m.currency) return r.eurRate;
  return null;
}

export interface QuoteRates { eurTry: number | null; rates?: Record<string, number> }

interface Node {
  m: FxMovement; r: MovementRates; isInvoice: boolean; side: 'revenue' | 'cost';
  /** original-currency amount counted in the totals */
  counted: number; usage: FxEvidence['usage'];
  /** what the counted amount settled, in the obligation's currency (invoice currency for settling cash) — basis of the FX gain/loss */
  obligations: { cur: string; amount: number }[];
}

const SIDE: Record<FxMovementType, { side: 'revenue' | 'cost'; invoice: boolean }> = {
  customer_invoice: { side: 'revenue', invoice: true }, collection: { side: 'revenue', invoice: false },
  supplier_invoice: { side: 'cost', invoice: true }, payment: { side: 'cost', invoice: false },
};

const byDate = (a: Node, b: Node) => (a.m.date ?? '9999').localeCompare(b.m.date ?? '9999');

function valueEur(n: Node, amount: number): number | null {
  return n.r.eurRate ? amount / n.r.eurRate : null;
}
function valueTry(n: Node, amount: number): number | null {
  if (n.m.currency === 'TRY') return amount;
  const e = valueEur(n, amount);
  return e != null && n.r.eurTryRate ? e * n.r.eurTryRate : null;
}

export function realizedFx(movements: FxMovement[], opts: { quoteRates?: QuoteRates | null } = {}): RealizedFx {
  const nodes: Node[] = movements
    .filter((m) => SIDE[m.type] && Number.isFinite(m.amount) && Math.abs(m.amount) > 0)
    .map((m) => ({ m: { ...m, amount: Math.abs(m.amount) }, r: normalizeMovementRates(m), isInvoice: SIDE[m.type].invoice, side: SIDE[m.type].side, counted: Math.abs(m.amount), usage: 'cash' as const, obligations: [] as { cur: string; amount: number }[] }));
  const reasons: { code: RealizedFxReasonCode; message: string }[] = [];
  let unsettled = 0;
  let unbilled = 0;

  for (const side of ['revenue', 'cost'] as const) {
    const invs = nodes.filter((n) => n.side === side && n.isInvoice).sort(byDate);
    const remaining = new Map(invs.map((n) => [n.m.id, n.m.amount]));
    const cash = nodes.filter((n) => n.side === side && !n.isInvoice).sort((a, b) => (a.m.settles ? 0 : 1) - (b.m.settles ? 0 : 1) || byDate(a, b));
    for (const c of cash) {
      let left = c.m.amount;
      const named = c.m.settles ? invs.find((i) => i.m.id === c.m.settles) : undefined;
      // a named invoice first, then FIFO over the side's other invoices
      const targets = named ? [named, ...invs.filter((i) => i !== named)] : invs;
      for (const inv of targets) {
        const rem = remaining.get(inv.m.id) ?? 0;
        if (rem <= EPS) continue;
        let k: number | null = 1; // cash currency → invoice currency, at the cash movement's own rates
        if (inv.m.currency !== c.m.currency) {
          const rInv = rateOf(c.m, c.r, inv.m.currency);
          const rCash = rateOf(c.m, c.r, c.m.currency);
          k = rInv && rCash ? rInv / rCash : null;
        }
        if (k == null) continue;
        const take = Math.min(rem, left * k);
        remaining.set(inv.m.id, rem - take);
        if (take > 0) c.obligations.push({ cur: inv.m.currency, amount: take });
        left -= take / k;
        if (left <= EPS) { left = 0; break; }
      }
      if (left > EPS) c.obligations.push({ cur: c.m.currency, amount: left });
      c.usage = left <= EPS ? 'cash' : left >= c.m.amount - EPS ? 'unbilled' : 'partly_unbilled';
      if (left > EPS) unbilled++;
    }
    for (const inv of invs) {
      const rem = Math.max(0, remaining.get(inv.m.id) ?? 0);
      inv.counted = rem <= EPS ? 0 : rem;
      inv.usage = rem <= EPS ? 'settled' : 'open';
      if (rem > EPS) inv.obligations.push({ cur: inv.m.currency, amount: rem });
      if (rem > EPS) unsettled++;
    }
  }

  const evidence: FxEvidence[] = nodes.map((n) => {
    const eur = valueEur(n, n.m.amount);
    const tr = valueTry(n, n.m.amount);
    return {
      movementId: n.m.id, type: n.m.type, date: n.m.date ?? null, amount: n.m.amount, currency: n.m.currency,
      eurRate: n.r.eurRate, eurTryRate: n.r.eurTryRate, rateSource: (n.r.eurRate || n.r.eurTryRate ? n.m.rateSource : 'missing') as FxRateSource,
      label: n.m.label ?? null, settles: n.m.settles ?? null,
      eur: eur != null ? round2(eur) : null, try: tr != null ? round2(tr) : null,
      countedEur: n.counted === 0 ? 0 : valueEur(n, n.counted) != null ? round2(valueEur(n, n.counted)!) : null,
      countedTry: n.counted === 0 ? 0 : valueTry(n, n.counted) != null ? round2(valueTry(n, n.counted)!) : null,
      usage: n.usage,
    };
  });
  evidence.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const missingRates = nodes.flatMap((n) => {
    const need: ('EUR' | 'TRY')[] = [];
    if (valueEur(n, n.m.amount) == null) need.push('EUR');
    if (valueTry(n, n.m.amount) == null) need.push('TRY');
    return need.length ? [{ movementId: n.m.id, type: n.m.type, currency: n.m.currency, need }] : [];
  });

  const has = { revenue: nodes.some((n) => n.side === 'revenue'), cost: nodes.some((n) => n.side === 'cost') };
  const sum = (side: 'revenue' | 'cost', f: (n: Node) => number | null) => {
    let s = 0;
    for (const n of nodes) if (n.side === side && n.counted > 0) s += f(n) ?? 0;
    return s;
  };
  const total = (side: 'revenue' | 'cost', cur: 'eur' | 'try') =>
    has[side] ? round2(sum(side, (n) => (cur === 'eur' ? valueEur(n, n.counted) : valueTry(n, n.counted)))) : null;
  const revenue = { eur: total('revenue', 'eur'), try: total('revenue', 'try') };
  const cost = { eur: total('cost', 'eur'), try: total('cost', 'try') };
  const both = has.revenue && has.cost;
  const profit = {
    eur: both ? round2(revenue.eur! - cost.eur!) : null,
    try: both ? round2(revenue.try! - cost.try!) : null,
  };
  const ratio = (a: number | null, b: number | null) => (a != null && b ? a / b : null);
  const margin = { eur: both ? ratio(profit.eur, revenue.eur) : null, try: both ? ratio(profit.try, revenue.try) : null };
  const markup = { eur: both ? ratio(profit.eur, cost.eur) : null, try: both ? ratio(profit.try, cost.try) : null };

  // weighted average EUR/TRY (EUR-weighted): Σ TRY ÷ Σ EUR over movements whose both values are proven
  const avg = (pick: (n: Node) => boolean, amt: (n: Node) => number) => {
    let e = 0;
    let t = 0;
    for (const n of nodes) {
      if (!pick(n) || amt(n) <= 0) continue;
      const ve = valueEur(n, amt(n));
      const vt = valueTry(n, amt(n));
      if (ve == null || vt == null) continue;
      e += ve;
      t += vt;
    }
    return e > 0 ? round6(t / e) : null;
  };
  const avgCollectionRate = avg((n) => n.m.type === 'collection', (n) => n.m.amount);
  const avgPaymentRate = avg((n) => n.m.type === 'payment', (n) => n.m.amount);
  const projectAvgRate = avg(() => true, (n) => n.counted);

  // FX gain / loss: profit at the actual rates − profit if every counted obligation had been converted at the quote-time rate
  const q = opts.quoteRates ?? null;
  const qRate = (cur: string): number | null => (cur === 'EUR' ? 1 : cur === 'TRY' ? pos(q?.eurTry) : pos(q?.rates?.[cur]));
  const fxGainLoss: RealizedFx['fxGainLoss'] = { eur: null, try: null };
  if (q && both) {
    let okE = profit.eur != null;
    let okT = profit.try != null;
    let pe = 0;
    let pt = 0;
    for (const n of nodes) {
      if (n.counted <= 0) continue;
      const sign = n.side === 'revenue' ? 1 : -1;
      // the obligation (invoice currency) at the quote-time rate: an EUR invoice collected in TRY has no EUR FX effect, only TRY
      let qe: number | null = 0;
      let qt: number | null = 0;
      for (const ob of n.obligations) {
        const qr = qRate(ob.cur);
        const e = qr ? ob.amount / qr : null;
        const t = ob.cur === 'TRY' ? ob.amount : e != null && pos(q.eurTry) ? e * q.eurTry! : null;
        qe = qe != null && e != null ? qe + e : null;
        qt = qt != null && t != null ? qt + t : null;
      }
      if (qe == null || valueEur(n, n.counted) == null) okE = false; else pe += sign * qe;
      if (qt == null || valueTry(n, n.counted) == null) okT = false; else pt += sign * qt;
    }
    if (okE) fxGainLoss.eur = round2(profit.eur! - pe);
    if (okT) fxGainLoss.try = round2(profit.try! - pt);
  }

  if (!nodes.length) reasons.push({ code: 'no_movements', message: 'Henüz gerçekleşen hareket yok (fatura / tahsilat / ödeme)' });
  else {
    if (missingRates.length) reasons.push({ code: 'rate_missing', message: `${missingRates.length} harekette gerçek kur yok — tahmin edilmedi (bilmiyorum); karşılığı toplamlara girmedi` });
    if (!has.revenue) reasons.push({ code: 'no_revenue', message: 'Müşteri faturası / tahsilat yok — kâr, marj ve markup hesaplanmadı' });
    if (!has.cost) reasons.push({ code: 'no_cost', message: 'Tedarikçi faturası / ödeme yok — kâr, marj ve markup hesaplanmadı' });
    if (unsettled) reasons.push({ code: 'unsettled_invoices', message: `${unsettled} fatura henüz tam tahsil edilmedi / ödenmedi — kalan kısım fatura kuruyla sayıldı` });
    if (unbilled) reasons.push({ code: 'unbilled_cash', message: `${unbilled} tahsilat / ödeme bir faturayla kapanmadı (faturasız veya fazla)` });
  }

  return {
    status: !nodes.length ? 'none' : reasons.length ? 'partial' : 'complete',
    revenue, cost, profit, margin, markup,
    avgCollectionRate, avgPaymentRate, projectAvgRate, quoteRate: pos(q?.eurTry),
    fxGainLoss, evidence, missingRates, reasons,
  };
}
