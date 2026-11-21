// e-Fatura / e-Arşiv UBL-TR 1.2 (GİB, UBL 2.1 Invoice) — deterministic reader (§7 Adım 7, docs/07 §4). No AI, confidence 1.0.
// Reads: invoice no (cbc:ID), ETTN (cbc:UUID), profile / type, issue date, currency, supplier + customer party (VKN / TCKN,
// name, tax office), lines, tax subtotals (KDV per rate — TaxTypeCode 0015, konaklama vergisi — 0059 / name), monetary totals
// (LegalMonetaryTotal), due date (PaymentMeans / PaymentTerms), notes, order / despatch references (PRJ-#### is picked up).
//
// Safety: DOCTYPE / ENTITY declarations are refused (no entity expansion, no external entities), size limit, namespace
// prefixes are stripped (cac:/cbc:/ns1: … all work). Values are kept as strings by the XML parser and parsed explicitly.
import { XMLParser } from 'fast-xml-parser';
import { badRequest } from '../errors.js';

export const MAX_UBL_BYTES = 5 * 1024 * 1024;

export interface UblParty { vkn: string | null; tckn: string | null; name: string | null; taxOffice: string | null; city: string | null }
export interface UblTax { code: string | null; name: string | null; percent: number | null; taxableAmount: number | null; amount: number }
export interface UblLine {
  id: string | null; name: string; quantity: number | null; unitCode: string | null; unitPrice: number | null; lineExtensionAmount: number | null;
  vatPercent: number | null; vatAmount: number | null; taxes: UblTax[];
}
export interface UblInvoice {
  profileId: string | null;
  invoiceTypeCode: string | null;
  invoiceNo: string;
  uuid: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  exchangeRate: number | null;
  supplier: UblParty;
  customer: UblParty;
  lines: UblLine[];
  taxes: UblTax[];
  vatTotal: number;
  /** KDV per rate: { '10': amount, '20': amount } */
  vatByRate: Record<string, number>;
  accommodationTax: number;
  lineExtensionAmount: number | null;
  taxExclusiveAmount: number | null;
  taxInclusiveAmount: number | null;
  allowanceTotalAmount: number | null;
  payableAmount: number | null;
  notes: string[];
  references: string[];
  /** PRJ-#### tags found in notes / references */
  projectRefs: string[];
  /** consistency checks (sum of lines vs totals …) — become alarms */
  warnings: string[];
}

type Node = Record<string, unknown> | string | undefined;

const ARRAYS = new Set(['InvoiceLine', 'TaxSubtotal', 'Note', 'PartyIdentification', 'TaxTotal', 'AdditionalDocumentReference', 'PaymentMeans', 'PaymentTerms', 'OrderReference', 'DespatchDocumentReference', 'WithholdingTaxTotal']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ARRAYS.has(name),
});

const r2 = (n: number) => Math.round(n * 100) / 100;

function text(n: unknown): string | null {
  if (n == null) return null;
  if (typeof n === 'string') return n.trim() || null;
  if (typeof n === 'number') return String(n);
  if (typeof n === 'object' && '#text' in (n as object)) return text((n as Record<string, unknown>)['#text']);
  return null;
}
function num(n: unknown): number | null {
  const t = text(n);
  if (t == null) return null;
  const v = Number(t.replace(/\s/g, ''));
  return Number.isFinite(v) ? v : null;
}
function attr(n: unknown, a: string): string | null {
  return n && typeof n === 'object' ? text((n as Record<string, unknown>)[`@${a}`]) : null;
}
function obj(n: unknown): Record<string, unknown> {
  return n && typeof n === 'object' && !Array.isArray(n) ? (n as Record<string, unknown>) : {};
}
function arr(n: unknown): unknown[] {
  return Array.isArray(n) ? n : n == null ? [] : [n];
}
function date(n: unknown): string | null {
  const t = text(n);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

function party(p: Node): UblParty {
  const x = obj(obj(p).Party);
  let vkn: string | null = null;
  let tckn: string | null = null;
  for (const id of arr(x.PartyIdentification)) {
    const node = obj(id).ID;
    const scheme = (attr(node, 'schemeID') ?? '').toUpperCase();
    const v = (text(node) ?? '').replace(/\D/g, '');
    if (scheme === 'VKN' && v) vkn = v;
    if (scheme === 'TCKN' && v) tckn = v;
  }
  const person = obj(x.Person);
  const personName = [text(person.FirstName), text(person.FamilyName)].filter(Boolean).join(' ') || null;
  return {
    vkn, tckn,
    name: text(obj(x.PartyName).Name) ?? personName,
    taxOffice: text(obj(obj(obj(x.PartyTaxScheme).TaxScheme)).Name),
    city: text(obj(x.PostalAddress).CityName),
  };
}

const ACCOMMODATION_TAX_CODES = new Set(['0059']);
const VAT_CODES = new Set(['0015']);

function taxes(totals: unknown): UblTax[] {
  const out: UblTax[] = [];
  for (const tt of arr(totals)) {
    for (const st of arr(obj(tt).TaxSubtotal)) {
      const s = obj(st);
      const scheme = obj(obj(s.TaxCategory).TaxScheme);
      out.push({
        code: text(scheme.TaxTypeCode), name: text(scheme.Name), percent: num(s.Percent), taxableAmount: num(s.TaxableAmount), amount: num(s.TaxAmount) ?? 0,
      });
    }
  }
  return out;
}
const isVat = (t: UblTax) => (t.code ? VAT_CODES.has(t.code) : /^(kdv|katma)/i.test(t.name ?? ''));
const isAccTax = (t: UblTax) => (t.code ? ACCOMMODATION_TAX_CODES.has(t.code) : false) || /konaklama/i.test(t.name ?? '');

/** True when the buffer looks like an XML document whose root element is a UBL Invoice. */
export function looksLikeUblInvoice(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<([A-Za-z0-9_]+:)?Invoice[\s>]/.test(head);
}

export function parseUblInvoice(buf: Buffer | string): UblInvoice {
  const raw = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (Buffer.byteLength(raw) > MAX_UBL_BYTES) throw badRequest('e-Fatura XML çok büyük', { maxBytes: MAX_UBL_BYTES }, 'UBL_TOO_LARGE');
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw badRequest('XML DOCTYPE / ENTITY bildirimi kabul edilmez', undefined, 'UBL_UNSAFE_XML');
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>;
  } catch (e) {
    throw badRequest(`XML okunamadı: ${(e as Error).message}`.slice(0, 300), undefined, 'UBL_INVALID_XML');
  }
  const inv = obj(doc.Invoice);
  if (!Object.keys(inv).length) throw badRequest('XML bir UBL-TR fatura (Invoice) değil', undefined, 'UBL_NOT_INVOICE');
  const invoiceNo = text(inv.ID);
  if (!invoiceNo) throw badRequest('Fatura numarası (cbc:ID) yok', undefined, 'UBL_INVALID');
  const currency = (text(inv.DocumentCurrencyCode) ?? 'TRY').toUpperCase().replace(/^TL$/, 'TRY');

  const lines: UblLine[] = arr(inv.InvoiceLine).map((l) => {
    const x = obj(l);
    const lt = taxes(x.TaxTotal);
    const vat = lt.filter(isVat);
    return {
      id: text(x.ID),
      name: text(obj(x.Item).Name) ?? text(obj(x.Item).Description) ?? text(arr(x.Note)[0]) ?? 'Kalem',
      quantity: num(x.InvoicedQuantity), unitCode: attr(x.InvoicedQuantity, 'unitCode'),
      unitPrice: num(obj(x.Price).PriceAmount), lineExtensionAmount: num(x.LineExtensionAmount),
      vatPercent: vat[0]?.percent ?? null, vatAmount: vat.length ? r2(vat.reduce((s, t) => s + t.amount, 0)) : null, taxes: lt,
    };
  });
  const allTaxes = taxes(inv.TaxTotal);
  const vatByRate: Record<string, number> = {};
  for (const t of allTaxes.filter(isVat)) {
    const k = String(t.percent ?? '?');
    vatByRate[k] = r2((vatByRate[k] ?? 0) + t.amount);
  }
  const vatTotal = r2(allTaxes.filter(isVat).reduce((s, t) => s + t.amount, 0));
  const accommodationTax = r2(allTaxes.filter(isAccTax).reduce((s, t) => s + t.amount, 0));
  const mt = obj(inv.LegalMonetaryTotal);

  let dueDate: string | null = null;
  for (const pm of arr(inv.PaymentMeans)) dueDate ??= date(obj(pm).PaymentDueDate);
  for (const pt of arr(inv.PaymentTerms)) dueDate ??= date(obj(pt).PaymentDueDate);

  const notes = arr(inv.Note).map(text).filter((x): x is string => !!x).slice(0, 50);
  const references = [
    ...arr(inv.OrderReference).map((r) => text(obj(r).ID)),
    ...arr(inv.DespatchDocumentReference).map((r) => text(obj(r).ID)),
    ...arr(inv.AdditionalDocumentReference).filter((r) => !obj(obj(r).Attachment).EmbeddedDocumentBinaryObject).map((r) => text(obj(r).ID)),
  ].filter((x): x is string => !!x).slice(0, 50);
  const projectRefs = [...new Set([...notes, ...references].flatMap((s) => (s.match(/PRJ-\d{3,6}/gi) ?? []).map((x) => x.toUpperCase())))];

  const out: UblInvoice = {
    profileId: text(inv.ProfileID), invoiceTypeCode: text(inv.InvoiceTypeCode), invoiceNo, uuid: text(inv.UUID)?.toLowerCase() ?? null,
    issueDate: date(inv.IssueDate), dueDate, currency, exchangeRate: num(obj(inv.PricingExchangeRate).CalculationRate),
    supplier: party(inv.AccountingSupplierParty as Node), customer: party(inv.AccountingCustomerParty as Node),
    lines, taxes: allTaxes, vatTotal, vatByRate, accommodationTax,
    lineExtensionAmount: num(mt.LineExtensionAmount), taxExclusiveAmount: num(mt.TaxExclusiveAmount), taxInclusiveAmount: num(mt.TaxInclusiveAmount),
    allowanceTotalAmount: num(mt.AllowanceTotalAmount), payableAmount: num(mt.PayableAmount),
    notes, references, projectRefs, warnings: [],
  };
  // consistency checks (a correct e-Fatura passes all of them; they only produce alarms, never change values)
  const linesSum = r2(lines.reduce((s, l) => s + (l.lineExtensionAmount ?? 0), 0));
  if (out.lineExtensionAmount != null && lines.length && Math.abs(linesSum - out.lineExtensionAmount) > 0.05) {
    out.warnings.push(`Kalem toplamı (${linesSum}) ≠ LineExtensionAmount (${out.lineExtensionAmount})`);
  }
  const taxSum = r2(allTaxes.reduce((s, t) => s + t.amount, 0));
  if (out.taxExclusiveAmount != null && out.taxInclusiveAmount != null && Math.abs(out.taxExclusiveAmount + taxSum - out.taxInclusiveAmount) > 0.05) {
    out.warnings.push(`Vergiler hariç ${out.taxExclusiveAmount} + vergiler ${taxSum} ≠ vergiler dahil ${out.taxInclusiveAmount}`);
  }
  if (!out.uuid) out.warnings.push('ETTN (cbc:UUID) yok');
  if (!out.supplier.vkn && !out.supplier.tckn) out.warnings.push('Satıcı VKN/TCKN yok');
  return out;
}

/** NET (matrah, all taxes excluded) as used by finance_entries.amount. */
export function ublNetAmount(u: UblInvoice): number | null {
  return u.taxExclusiveAmount ?? (u.lineExtensionAmount != null ? r2(u.lineExtensionAmount - (u.allowanceTotalAmount ?? 0)) : null);
}
