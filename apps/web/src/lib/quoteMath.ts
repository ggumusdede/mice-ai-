// Live totals for the quote builder (display only — the server re-validates and is authoritative).
export interface BuilderLine {
  serviceItemId: string;
  include: boolean;
  offerId: string | null;
  /** cost of the chosen offer in EUR (normalized net, ex VAT); 0 for value-add items */
  costEur: number;
  /** fraction on cost */
  markup: number;
  valueAdd: boolean;
  quantity: number;
  /** value-add items: sale unit price in EUR set by the agency */
  unitPriceEur?: number;
}

export interface Totals {
  costEur: number;
  saleEur: number;
  profitEur: number;
  /** Kâr ÷ Satış */
  margin: number;
  /** Kâr ÷ Alış */
  markup: number;
}

export function lineSaleEur(l: BuilderLine): number {
  if (l.valueAdd) return round2((l.unitPriceEur ?? 0) * (l.quantity || 0));
  return round2(l.costEur * (1 + (Number.isFinite(l.markup) ? l.markup : 0)));
}

export function optionTotals(lines: BuilderLine[]): Totals {
  let cost = 0;
  let sale = 0;
  for (const l of lines) {
    if (!l.include) continue;
    cost += l.valueAdd ? 0 : l.costEur;
    sale += lineSaleEur(l);
  }
  const profit = sale - cost;
  return {
    costEur: round2(cost),
    saleEur: round2(sale),
    profitEur: round2(profit),
    margin: sale !== 0 ? profit / sale : 0,
    markup: cost !== 0 ? profit / cost : 0,
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Client-side pre-check mirroring §7 Adım 3 rules (server is authoritative). */
export function preCheck(totals: Totals, opts: { targetMarginMin: number }): string[] {
  const issues: string[] = [];
  if (totals.saleEur <= 0) issues.push('Seçenekte satış tutarı yok.');
  else if (totals.margin < opts.targetMarginMin) issues.push(`Marj hedefin altında (${(totals.margin * 100).toFixed(1)}% < ${(opts.targetMarginMin * 100).toFixed(0)}%) — yalnız yönetici gerekçe ile açabilir.`);
  return issues;
}
