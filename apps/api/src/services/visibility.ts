// Who sees what (security review G-15 / G-16, residual risks 4–6 of docs/09). Both are tenant rules ([Ürün kararı]):
//  - hideCustomerFromSuppliers (default true): every supplier-facing output uses the supplier-safe reference
//    (PRJ-0042-20270312-80) — the project code carries the customer name, a supplier could bypass the agency.
//  - fieldRoleCanSeeFinancials (default false): the field role does not see profit, P&L, finance entries, quote cost /
//    margin, contract amounts or other users' drafts. Enforced here, server-side; the web UI only hides what it cannot get.
import type { AuditEntry, DocumentKind, MessageDraft, ProjectDetail, SimilarProject } from '@mice/shared';
import { supplierSafeCode } from '@mice/domain';
import type { Ctx } from '../context.js';
import { forbidden } from '../errors.js';

/** Project reference for anything a supplier receives or sees. */
export async function supplierRef(ctx: Ctx, code: string): Promise<string> {
  return (await ctx.rules()).hideCustomerFromSuppliers ? supplierSafeCode(code) : code;
}

/** Document kinds that carry purchase cost / margin / sale totals. */
export const FINANCIAL_DOC_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>(['pnl', 'customer_invoice_draft', 'quote']);

/** Audit entities whose before/after images contain prices, costs or amounts. */
const FINANCIAL_AUDIT_ENTITIES = new Set([
  'quotes', 'quote_lines', 'supplier_offers', 'finance_entries', 'bank_transactions', 'commissions', 'price_history', 'documents',
  'contracts', 'decisions', 'message_drafts', 'channel_prices', 'service_items',
]);

/** false for the field role unless the tenant rule allows it (staff roles other than field are unaffected). */
export async function canSeeFinancials(ctx: Ctx): Promise<boolean> {
  if (!ctx.user || ctx.user.role !== 'field') return true;
  return (await ctx.rules()).fieldRoleCanSeeFinancials === true;
}

export async function assertFinancialsVisible(ctx: Ctx): Promise<void> {
  if (!(await canSeeFinancials(ctx))) {
    throw forbidden('Bu rol finansal verileri (kâr, maliyet, marj, finans kayıtları) göremez', 'FINANCIALS_HIDDEN');
  }
}

export function redactAudit(entries: AuditEntry[]): AuditEntry[] {
  return entries.map((e) => (FINANCIAL_AUDIT_ENTITIES.has(e.entity) ? { ...e, before: null, after: null } : e));
}

/** Project detail without money: no profit, no offers / evaluations / item cost & sale, no quotes, no contracts, no
 *  financial documents, audit images of financial rows dropped. */
export function redactProjectDetail(d: ProjectDetail): ProjectDetail {
  return {
    ...d,
    items: d.items.map((i) => ({ ...i, offers: [], evaluations: [], costEur: null, saleEur: null, priceClass: null })),
    quotes: [],
    contracts: [],
    documents: d.documents.filter((doc) => !FINANCIAL_DOC_KINDS.has(doc.kind)),
    alerts: d.alerts.filter((a) => a.code !== 'OFFER_NEEDS_REVIEW'),
    profit: { expected: null, realized: null },
    recentActivity: redactAudit(d.recentActivity),
  };
}

export function redactSimilar(rows: SimilarProject[]): SimilarProject[] {
  return rows.map((r) => ({ ...r, totalSaleEur: null, margin: null }));
}

/** Field role without financials: drafts only when the user is the sender (from_user_id). */
export async function visibleDrafts(ctx: Ctx, drafts: MessageDraft[]): Promise<MessageDraft[]> {
  if (await canSeeFinancials(ctx)) return drafts;
  return drafts.filter((d) => d.fromUserId === ctx.user!.id);
}

/** Financial document kinds (P&L, quote, customer invoice draft) are refused for a role without financials. */
export async function assertDocumentVisible(ctx: Ctx, documentId: string): Promise<void> {
  if (await canSeeFinancials(ctx)) return;
  const { rows } = await ctx.db.query('SELECT kind FROM documents WHERE id = $1', [documentId]);
  if (rows[0] && FINANCIAL_DOC_KINDS.has(rows[0].kind)) throw forbidden('Bu rol finansal belgeleri göremez', 'FINANCIALS_HIDDEN');
}
