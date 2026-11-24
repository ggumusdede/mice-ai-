// Evidence-based realized FX (ürün sahibi kararı Q5; §7 Adım 7–8). Collects a project's money movements — customer / supplier
// invoices, collections and payments (matched bank lines, payment records, imported historical movements) — each with the ACTUAL
// rate it was made at (never today's rate) and hands them to the pure domain `realizedFx`. Internal currency stays EUR.
import type { Currency, FxMovement, FxRateSource, RealizedFx } from '@mice/shared';
import { fillRatesFromTable, realizedFx, type QuoteRates } from '@mice/domain';
import { ratesTable } from './fx-rates.js';
import type { Ctx } from '../context.js';
import type { Row } from '../lib/mappers.js';

const n = (v: unknown): number | null => (v == null ? null : Number(v));
const INVOICE_KINDS = ['customer_invoice', 'supplier_invoice'];
const OUT_KINDS = ['payable', 'supplier_invoice', 'payment_out'];

const dateOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Rates of an invoice / imported movement row (only what is proven). */
function entryRates(e: Row): { eurRate: number | null; eurTryRate: number | null; rateSource: FxRateSource } {
  const cur = e.currency as string;
  const eurTry = n(e.eur_try_rate);
  const actual = n(e.actual_fx_rate);
  const eurRate = cur === 'EUR' ? 1 : cur === 'TRY' ? eurTry ?? actual : actual;
  const src = (e.rate_source as FxRateSource | null) ?? (cur === 'EUR' ? 'currency' : 'missing');
  return { eurRate, eurTryRate: cur === 'TRY' ? eurTry ?? actual : eurTry, rateSource: src };
}

function entryLabel(e: Row): string {
  const kind = { customer_invoice: 'Müşteri faturası', supplier_invoice: 'Tedarikçi faturası', payable: 'Tedarikçi borcu', receivable: 'Müşteri alacağı', payment_in: 'Tahsilat', payment_out: 'Ödeme' }[e.kind as string] ?? e.kind;
  const no = e.invoice_no ?? e.meta?.invoiceNo ?? e.meta?.docNo ?? null;
  return [kind, no, e.supplier_name].filter(Boolean).join(' · ');
}

export async function projectMovements(ctx: Ctx, projectId: string): Promise<FxMovement[]> {
  const entries = (await ctx.db.query(
    `SELECT e.*, s.name AS supplier_name FROM finance_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.project_id = $1 AND e.status <> 'cancelled' AND e.kind <> 'commission' ORDER BY e.created_at`, [projectId])).rows;
  const bank = (await ctx.db.query(
    `SELECT b.* FROM bank_transactions b JOIN finance_entries e ON e.id = b.matched_entry_id
      WHERE e.project_id = $1 AND b.status = 'matched' AND e.kind <> 'commission' AND e.status <> 'cancelled'`, [projectId])).rows;
  const byId = new Map(entries.map((e) => [e.id as string, e]));
  const out: FxMovement[] = [];
  for (const e of entries) {
    if (INVOICE_KINDS.includes(e.kind)) {
      out.push({
        id: e.id, type: e.kind, date: dateOf(e.value_date) ?? dateOf(e.meta?.issueDate) ?? dateOf(e.created_at), amount: Number(e.amount), currency: e.currency,
        ...entryRates(e), label: entryLabel(e), settles: null,
      });
    } else if (e.kind === 'payment_in' || e.kind === 'payment_out') {
      // imported historical cash movement
      out.push({
        id: e.id, type: e.kind === 'payment_in' ? 'collection' : 'payment', date: dateOf(e.value_date) ?? dateOf(e.created_at), amount: Number(e.amount), currency: e.currency,
        ...entryRates(e), label: entryLabel(e), settles: typeof e.meta?.settlesEntryId === 'string' ? e.meta.settlesEntryId : null,
      });
    }
  }
  const bankFor = new Set<string>();
  for (const b of bank) {
    const e = byId.get(b.matched_entry_id);
    if (!e) continue;
    bankFor.add(e.id);
    const cur = b.currency as Currency;
    // a payment record with a rate complements a bank line without one
    const paidRate = e.paid_currency === cur ? { fx: n(e.paid_fx_rate), eurTry: n(e.paid_eur_try_rate), src: e.paid_rate_source } : null;
    const eurTry = n(b.eur_try_rate) ?? paidRate?.eurTry ?? null;
    const fx = n(b.fx_rate) ?? paidRate?.fx ?? null;
    out.push({
      id: b.id, type: Number(b.amount) < 0 ? 'payment' : 'collection', date: dateOf(b.booked_at), amount: Math.abs(Number(b.amount)), currency: cur,
      eurRate: cur === 'EUR' ? 1 : cur === 'TRY' ? eurTry ?? fx : fx, eurTryRate: cur === 'TRY' ? eurTry ?? fx : eurTry,
      rateSource: (b.rate_source ?? (n(b.eur_try_rate) == null && n(b.fx_rate) == null ? paidRate?.src : null) ?? (cur === 'EUR' ? 'currency' : 'missing')) as FxRateSource,
      rateNote: n(b.eur_try_rate) != null || n(b.fx_rate) != null ? 'banka' : null,
      label: `Banka · ${b.description}${b.counterparty ? ` · ${b.counterparty}` : ''}`, settles: INVOICE_KINDS.includes(e.kind) ? e.id : null,
    });
  }
  // payment records (mark-paid) not (yet) matched to a bank line
  for (const e of entries) {
    if (!e.paid_at || bankFor.has(e.id) || !['payable', 'supplier_invoice', 'receivable', 'customer_invoice'].includes(e.kind)) continue;
    const cur = (e.paid_currency ?? e.currency) as Currency;
    const eurTry = n(e.paid_eur_try_rate);
    const fx = n(e.paid_fx_rate);
    out.push({
      id: `${e.id}:paid`, type: OUT_KINDS.includes(e.kind) ? 'payment' : 'collection', date: dateOf(e.paid_at), amount: Number(e.paid_amount ?? e.amount), currency: cur,
      eurRate: cur === 'EUR' ? 1 : cur === 'TRY' ? eurTry ?? fx : fx, eurTryRate: cur === 'TRY' ? eurTry ?? fx : eurTry,
      rateSource: (e.paid_rate_source ?? (cur === 'EUR' ? 'currency' : 'missing')) as FxRateSource,
      label: `Ödeme kaydı · ${entryLabel(e)}${e.meta?.paymentReference ? ` · ${e.meta.paymentReference}` : ''}`, settles: INVOICE_KINDS.includes(e.kind) ? e.id : null,
    });
  }
  return out;
}

/** EUR/TRY (and the quote currency) of the accepted quote, at its fx_date (the quote-time rate). */
export async function quoteRates(ctx: Ctx, projectId: string): Promise<QuoteRates | null> {
  const q = (await ctx.db.query(
    `SELECT currency, fx_rate, fx_date, base_currency, fx_policy FROM quotes WHERE project_id = $1 AND status = 'accepted' ORDER BY version DESC LIMIT 1`, [projectId])).rows[0]
    ?? (await ctx.db.query(`SELECT currency, fx_rate, fx_date, base_currency, fx_policy FROM quotes WHERE project_id = $1 AND status <> 'superseded' ORDER BY version DESC LIMIT 1`, [projectId])).rows[0];
  if (!q) return null;
  const rows = (await ctx.db.query(
    `SELECT DISTINCT ON (currency) currency, rate FROM fx_rates WHERE rate_type IS NULL AND rate_date <= $1 ORDER BY currency, rate_date DESC, created_at DESC`, [q.fx_date])).rows;
  const rates: Record<string, number> = Object.fromEntries(rows.map((r) => [r.currency, Number(r.rate)]));
  // v0.5: fx_rate = 1 <base> = x <quote currency>, buffer included → the quote-time MARKET rate (fx_policy.marketRate) in EUR terms
  const base = (q.base_currency ?? 'EUR') as string;
  const market = Number(q.fx_policy?.marketRate ?? q.fx_rate);
  const eurBase = base === 'EUR' ? 1 : rates[base] ?? null;
  if (eurBase != null) rates[q.currency] = q.currency === 'EUR' ? 1 : market * eurBase;
  return { eurTry: rates.TRY ?? null, rates };
}

export async function projectRealizedFx(ctx: Ctx, projectId: string): Promise<RealizedFx> {
  const [movements, qr, p] = await Promise.all([
    projectMovements(ctx, projectId), quoteRates(ctx, projectId),
    ctx.db.query('SELECT historical, base_currency FROM projects WHERE id = $1', [projectId]).then((r) => r.rows[0]),
  ]);
  // movements made without conversion (EUR paid in EUR …): TRY value from the TCMB rate of the value date (rule fxRateTypeForReporting)
  const rateType = (await ctx.rules()).fxRateTypeForReporting ?? 'tcmb_forex_buying';
  const table = await ratesTable(ctx, rateType, movements.map((m) => m.date ?? ''));
  // v0.5 S-19: realized figures also in the project's base currency (USD base: EUR/USD of each movement's value date)
  const baseCurrency = p?.base_currency ?? 'EUR';
  const r = realizedFx(fillRatesFromTable(movements, table, rateType, undefined, baseCurrency), { quoteRates: qr, baseCurrency });
  if (p?.historical && !movements.length) {
    r.reasons.push({ code: 'no_fx_evidence', message: 'Geçmiş proje: finansal hareket aktarılmadı — kur kanıtı yok; toplamlar aktarım günündeki kayıtlı kurla (kanıtsız)' });
  }
  return r;
}
