// e-Fatura (UBL-TR XML) → supplier invoice input (§7 Adım 7). Deterministic, bypasses AI (confidence 1.0):
//   supplier  = suppliers.tax_number = seller VKN/TCKN, else exact (case-insensitive, Turkish-folded) name match
//   project   = explicit projectId, else a PRJ-#### reference in the invoice notes / order reference, else the single open
//               (not closed) project holding a signed contract with that supplier
//   duplicate = same ETTN (finance_entries.ubl_uuid) → 409, same invoice no per supplier → 409 (existing check)
// The amount-mismatch alarm, contract linking and commission logic stay in recordSupplierInvoice (finance.ts).
import type { SupplierInvoiceInput } from '@mice/shared';
import { slugTr } from '@mice/domain';
import type { Ctx } from '../context.js';
import { badRequest, conflict } from '../errors.js';
import { parseUblInvoice, ublNetAmount, looksLikeUblInvoice, type UblInvoice } from './ubl-tr.js';
import type { UploadedFile } from './offers.js';

export function isUblUpload(file: UploadedFile | undefined): boolean {
  if (!file) return false;
  const xmlish = /\.xml$/i.test(file.filename) || /xml/i.test(file.mimetype);
  return xmlish && looksLikeUblInvoice(file.buffer);
}

export interface UblApplied { ubl: UblInvoice; alarms: string[] }

/** Fills `data` (only fields the caller did not give) from the e-Fatura. */
export async function applyUblInvoice(ctx: Ctx, file: UploadedFile, data: Partial<SupplierInvoiceInput>): Promise<UblApplied> {
  const ubl = parseUblInvoice(file.buffer);
  const alarms = [...ubl.warnings];
  if (ubl.uuid) {
    const dup = (await ctx.db.query(`SELECT id, invoice_no FROM finance_entries WHERE lower(ubl_uuid) = $1 AND status <> 'cancelled'`, [ubl.uuid])).rows[0];
    if (dup) throw conflict(`Bu e-Fatura zaten kayıtlı (ETTN ${ubl.uuid}, ${dup.invoice_no})`, 'DUPLICATE_INVOICE');
  }
  if (!['EUR', 'TRY', 'USD', 'GBP'].includes(ubl.currency)) throw badRequest(`Desteklenmeyen para birimi: ${ubl.currency}`, undefined, 'UNSUPPORTED_CURRENCY');

  if (!data.supplierId) {
    const taxNo = ubl.supplier.vkn ?? ubl.supplier.tckn;
    let s = taxNo ? (await ctx.db.query(`SELECT id FROM suppliers WHERE regexp_replace(tax_number, '\\D', '', 'g') = $1 ORDER BY status = 'passive' LIMIT 1`, [taxNo])).rows[0] : null;
    if (!s && ubl.supplier.name) {
      const key = slugTr(ubl.supplier.name);
      const all = (await ctx.db.query('SELECT id, name FROM suppliers')).rows;
      s = all.find((x) => slugTr(x.name) === key) ?? all.find((x) => key.length >= 6 && (slugTr(x.name).startsWith(key) || key.startsWith(slugTr(x.name)))) ?? null;
      if (s && taxNo) alarms.push(`Tedarikçi VKN ${taxNo} kartta kayıtlı değil — ad ile eşleştirildi (${ubl.supplier.name})`);
    }
    if (!s) throw badRequest(`e-Fatura satıcısı tanınmadı (${ubl.supplier.name ?? '-'} / VKN ${taxNo ?? '-'}) — supplierId gönderin`, { ubl: summary(ubl) }, 'SUPPLIER_REQUIRED');
    data.supplierId = s.id;
  }
  if (!data.projectId) {
    for (const ref of ubl.projectRefs) {
      const p = (await ctx.db.query(`SELECT id FROM projects WHERE upper(code) = $1 OR upper(code) LIKE $1 || '-%' LIMIT 1`, [ref])).rows[0];
      if (p) {
        data.projectId = p.id;
        break;
      }
    }
  }
  if (!data.projectId) {
    const ps = (await ctx.db.query(
      `SELECT DISTINCT c.project_id FROM contracts c JOIN projects p ON p.id = c.project_id
        WHERE c.supplier_id = $1 AND c.status IN ('signed','amended') AND c.superseded_by IS NULL AND p.closed_at IS NULL`, [data.supplierId])).rows;
    if (ps.length === 1) data.projectId = ps[0].project_id;
    else throw badRequest('Fatura hangi projeye ait? projectId gönderin', { candidates: ps.map((x) => x.project_id), ubl: summary(ubl) }, 'INVOICE_LINK_REQUIRED');
  }
  data.invoiceNo ??= ubl.invoiceNo;
  data.currency ??= ubl.currency;
  data.amount ??= ublNetAmount(ubl) ?? undefined;
  data.vatAmount ??= ubl.vatTotal;
  data.issueDate ??= ubl.issueDate ?? undefined;
  data.dueDate ??= ubl.dueDate ?? undefined;
  return { ubl, alarms };
}

/** Stored in finance_entries.meta.ubl (no XML copy; lines kept for the plan-vs-actual view). */
export function summary(u: UblInvoice): Record<string, unknown> {
  return {
    uuid: u.uuid, profileId: u.profileId, invoiceTypeCode: u.invoiceTypeCode, invoiceNo: u.invoiceNo, issueDate: u.issueDate, dueDate: u.dueDate,
    currency: u.currency, exchangeRate: u.exchangeRate, supplier: u.supplier, customer: u.customer, vatByRate: u.vatByRate, vatTotal: u.vatTotal,
    accommodationTax: u.accommodationTax, taxExclusiveAmount: u.taxExclusiveAmount, taxInclusiveAmount: u.taxInclusiveAmount, payableAmount: u.payableAmount,
    lines: u.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitCode: l.unitCode, unitPrice: l.unitPrice, amount: l.lineExtensionAmount, vatPercent: l.vatPercent })),
    taxes: u.taxes,
  };
}
