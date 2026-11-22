// Phase B document generators (§3.1 belgeler veriden üretilir, §3.5 değişiklik yayılımı): event program, rooming list (KVKK)
// and the realized part of the internal P&L (plan vs actual, margin and markup separately). Registered with the documents
// service, so staleness / "Yeniden üret" work like for the quote and the P&L.
//
// KVKK (§17.9): the rooming_list DOCUMENT never stores personal data — its content is counts only. The standard Excel template is
// rendered live by `roomingListXlsx()` for the requesting user: clear names / e-mail / phone only for roles with
// `view_guest_pii`, masked labels for everyone else.
import ExcelJS from 'exceljs';
import type { ProfitSummary, RealizedFx } from '@mice/shared';
import { roleCan } from '@mice/domain';
import type { Ctx } from '../context.js';
import { conflict } from '../errors.js';
import { addDaysIso, isoDate, nightsBetween } from '../lib/dates.js';
import type { Row } from '../lib/mappers.js';
import { computeClosingCheck } from './closing.js';
import { registerDocumentGenerator } from './documents.js';
import { currentFx, toEur } from './fx.js';
import { listGuests } from './guests.js';
import { money, pct, renderPdf, type PdfSpec } from './pdf.js';
import { getProjectRow } from './projects.js';
import { supplierRef } from './visibility.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const KIND_TR: Record<string, string> = {
  accommodation: 'Konaklama', hall: 'Salon', fnb: 'Yiyecek-içecek', transfer: 'Transfer', technical: 'Teknik', activity: 'Aktivite', ticket: 'Bilet', other: 'Diğer',
};
const UNIT_TR: Record<string, string> = { room_night: 'oda/gece', day: 'gün', pax_day: 'kişi/gün', pax: 'kişi', lump_sum: 'götürü', piece: 'adet', vehicle: 'araç', hour: 'saat' };

async function tenantName(ctx: Ctx): Promise<string> {
  return (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
}

// ------------------------------------------------------------------ event program
interface ProgramDay { date: string; label: string; entries: { kind: string; description: string; supplier: string | null; quantity: string; notes: string | null }[] }

function dayLabel(d: string): string {
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
}

/** Days of the event (start..end, max 31) with the service items that run on each day (item dates, else the whole event). */
export async function buildProgram(ctx: Ctx, projectId: string): Promise<{ p: Row; days: ProgramDay[]; undated: ProgramDay['entries'] }> {
  const p = await getProjectRow(ctx, projectId);
  const items = (await ctx.db.query(
    `SELECT si.*, s.name AS supplier_name FROM service_items si
       LEFT JOIN supplier_offers o ON o.id = si.selected_offer_id LEFT JOIN suppliers s ON s.id = o.supplier_id
      WHERE si.project_id = $1 AND si.status <> 'cancelled' ORDER BY si.sort, si.created_at`, [projectId])).rows;
  const start = p.start_date ?? null;
  const end = p.end_date ?? p.start_date ?? null;
  const entry = (it: Row) => ({
    kind: KIND_TR[it.kind] ?? it.kind, description: it.description as string, supplier: (it.supplier_name as string | null) ?? null,
    quantity: `${Number(it.quantity)} ${UNIT_TR[it.unit] ?? it.unit}${it.nights ? ` · ${it.nights} gece` : ''}`,
    notes: it.specs && Object.keys(it.specs).length ? Object.entries(it.specs).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : null,
  });
  if (!start || !end) return { p, days: [], undated: items.map(entry) };
  const days: ProgramDay[] = [];
  for (let d = start, i = 0; d <= end && i < 31; d = addDaysIso(d, 1), i++) {
    days.push({
      date: d, label: dayLabel(d),
      entries: items.filter((it) => {
        const from = it.date_from ?? start;
        // accommodation runs over nights: check-in day … the day before check-out (the departure day is shown too)
        const to = it.date_to ?? end;
        return from <= d && d <= to;
      }).map(entry),
    });
  }
  return { p, days, undated: [] };
}

// ------------------------------------------------------------------ rooming list (standard Excel template)
/** Standard hotel rooming list template (one row per guest). PII decrypted only for `view_guest_pii` roles. */
export async function roomingListXlsx(ctx: Ctx, projectId: string): Promise<{ fileName: string; data: Buffer; rows: number; masked: boolean }> {
  const p = await getProjectRow(ctx, projectId);
  const guests = await listGuests(ctx, projectId); // decrypts only for authorized roles
  const masked = !(ctx.user && roleCan(ctx.user.role, 'view_guest_pii'));
  const hotel = (await ctx.db.query(
    `SELECT s.name FROM service_items si JOIN supplier_offers o ON o.id = si.selected_offer_id JOIN suppliers s ON s.id = o.supplier_id
      WHERE si.project_id = $1 AND si.kind = 'accommodation' AND si.status <> 'cancelled' ORDER BY si.sort LIMIT 1`, [projectId])).rows[0]?.name ?? p.venue_name ?? '';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MICE AI Operations OS';
  const ws = wb.addWorksheet('Rooming List');
  const ref = await supplierRef(ctx, p.code); // sent to the hotel → supplier-safe reference (hideCustomerFromSuppliers)
  ws.columns = [{ width: 6 }, { width: 32 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 7 }, { width: 28 }, { width: 18 }, { width: 24 }];
  const head: [string, string][] = [
    ['Acenta', await tenantName(ctx)], ['Otel', hotel], ['Proje', ref], ['Etkinlik', p.title ?? ''],
    ['Tarih', `${p.start_date ?? '?'} – ${p.end_date ?? '?'}`], ['Oluşturma', isoDate(ctx.now())],
  ];
  ws.addRow(['ROOMING LIST']).font = { bold: true, size: 14 };
  for (const [k, v] of head) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  if (masked) ws.addRow(['', 'Kişisel veriler maskelendi (KVKK — yetkili rol gerekli)']).font = { italic: true, color: { argb: 'FF996600' } };
  ws.addRow([]);
  const header = ws.addRow(['No', 'Ad Soyad', 'Oda Tipi', 'Giriş', 'Çıkış', 'Gece', 'E-posta', 'Telefon', 'Not']);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    c.border = { bottom: { style: 'thin' } };
  });
  guests.forEach((g, i) => {
    const arrival = g.arrival ?? p.start_date ?? null;
    const departure = g.departure ?? p.end_date ?? null;
    ws.addRow([
      i + 1, g.fullName, g.roomType ?? '', arrival ?? '', departure ?? '', nightsBetween(arrival, departure) ?? '',
      g.email ?? '', g.phone ?? '', g.anonymizedAt ? 'anonimleştirildi' : g.consentReuse && !g.consentWithdrawnAt ? 'rıza var' : '',
    ]);
  });
  const byRoom = new Map<string, number>();
  for (const g of guests) byRoom.set(g.roomType ?? '—', (byRoom.get(g.roomType ?? '—') ?? 0) + 1);
  ws.addRow([]);
  ws.addRow(['', `Toplam misafir: ${guests.length}`]).font = { bold: true };
  for (const [room, n] of byRoom) ws.addRow(['', `${room}: ${n}`]);
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return { fileName: `${ref}-rooming-list.xlsx`, data, rows: guests.length, masked };
}

// ------------------------------------------------------------------ realized P&L (used by the 'pnl' generator in quotes.ts)
export interface RealizedPnl {
  planned: ProfitSummary | null;
  actual: ProfitSummary | null;
  deviations: { reason: string; amountEur: number }[];
  suppliers: { supplier: string; contractEur: number; invoicedEur: number; differenceEur: number }[];
  customerInvoicedEur: number;
  extras: { totalEur: number; reflectedEur: number; unreflectedEur: number };
  /** (additive, Q5) evidence-based realized EUR + TRY, average rates, FX gain/loss and the evidence table */
  realizedFx?: RealizedFx | null;
  plannedTry?: { cost: number; sale: number; profit: number } | null;
}

export async function realizedPnl(ctx: Ctx, projectId: string): Promise<RealizedPnl | null> {
  const check = await computeClosingCheck(ctx, projectId);
  const sup = (await ctx.db.query(
    `SELECT s.name, e.kind, sum(e.amount_eur) AS eur FROM finance_entries e JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.project_id = $1 AND e.kind IN ('payable','supplier_invoice') AND e.status <> 'cancelled' GROUP BY s.name, e.kind ORDER BY s.name`, [projectId])).rows;
  const names = [...new Set(sup.map((r) => r.name as string))];
  const suppliers = names.map((n) => {
    const contractEur = r2(Number(sup.find((r) => r.name === n && r.kind === 'payable')?.eur ?? 0));
    const invoicedEur = r2(Number(sup.find((r) => r.name === n && r.kind === 'supplier_invoice')?.eur ?? 0));
    return { supplier: n, contractEur, invoicedEur, differenceEur: r2(invoicedEur - contractEur) };
  });
  const cust = Number((await ctx.db.query(
    `SELECT COALESCE(sum(amount_eur),0) AS s FROM finance_entries WHERE project_id = $1 AND kind = 'customer_invoice' AND status <> 'cancelled'`, [projectId])).rows[0].s);
  const ex = (await ctx.db.query(
    `SELECT COALESCE(sum(amount_try),0) AS total, COALESCE(sum(amount_try) FILTER (WHERE reflected_to_customer), 0) AS refl,
            COALESCE(sum(amount_try) FILTER (WHERE reflected_to_customer = false), 0) AS unrefl
       FROM field_extras WHERE project_id = $1 AND admin_status <> 'rejected'`, [projectId])).rows[0];
  const fx = await currentFx(ctx.db);
  const toEurTry = (v: unknown) => (fx.rates.TRY ? r2(toEur(fx, Number(v), 'TRY')) : 0);
  if (!check.planVsActual.planned && !check.planVsActual.actual && !suppliers.length && check.planVsActual.realizedFx?.status !== 'complete' && check.planVsActual.realizedFx?.status !== 'partial') return null;
  return {
    planned: check.planVsActual.planned, actual: check.planVsActual.actual, deviations: check.planVsActual.deviations, suppliers,
    customerInvoicedEur: r2(cust), extras: { totalEur: toEurTry(ex.total), reflectedEur: toEurTry(ex.refl), unreflectedEur: toEurTry(ex.unrefl) },
    realizedFx: check.planVsActual.realizedFx ?? null, plannedTry: check.planVsActual.plannedTry ?? null,
  };
}

/** PDF section rows for the plan vs actual table (margin and markup on separate rows, §9). */
export function planVsActualRows(r: RealizedPnl): string[][] {
  const row = (label: string, f: (s: ProfitSummary) => number, fmt: (n: number) => string, diff = true) => {
    const a = r.planned ? f(r.planned) : null;
    const b = r.actual ? f(r.actual) : null;
    return [label, a != null ? fmt(a) : '—', b != null ? fmt(b) : '—', diff && a != null && b != null ? fmt(b - a) : '—'];
  };
  const eur = (n: number) => money(r2(n), 'EUR');
  return [
    row('Alış (maliyet)', (s) => s.costEur, eur), row('Satış', (s) => s.saleEur, eur), row('Kâr', (s) => s.profitEur, eur),
    row('Marj (Kâr ÷ Satış)', (s) => s.margin, pct, false), row('Markup (Kâr ÷ Alış)', (s) => s.markup, pct, false),
  ];
}

const RATE_SOURCE_TR: Record<string, string> = {
  currency: 'EUR (kur gerekmez)', efatura: 'e-Fatura kuru', invoice: 'fatura kuru', bank_derived: 'banka (tutarlardan)', payment_record: 'ödeme kaydı',
  payment_derived: 'ödeme kaydı (tutarlardan)', import: 'aktarım', tcmb: 'TCMB', manual: 'elle', missing: 'KUR YOK',
};
const TYPE_TR: Record<string, string> = { customer_invoice: 'Müşteri faturası', supplier_invoice: 'Tedarikçi faturası', collection: 'Tahsilat', payment: 'Ödeme' };

/** PDF sections (Q5): realized EUR + TRY side by side, average rates, FX lines and the evidence table (every number provable). */
export function realizedFxSections(r: RealizedPnl): PdfSpec['sections'] {
  const fx = r.realizedFx;
  if (!fx) return [];
  const try_ = (n: number | null | undefined) => (n == null ? '—' : money(n, 'TRY'));
  const eur = (n: number | null | undefined) => (n == null ? '—' : money(n, 'EUR'));
  const p = (n: number | null | undefined) => (n == null ? '—' : pct(n));
  const rate = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('tr-TR', { maximumFractionDigits: 4 }));
  return [
    {
      kind: 'table',
      table: {
        title: `Gerçekleşen (kanıtlı kurlarla) — ${fx.status === 'complete' ? 'tam' : fx.status === 'partial' ? 'KISMİ' : 'hareket yok'}`,
        columns: [{ label: '', width: 175 }, { label: 'EUR', width: 110, align: 'right' }, { label: 'TL', width: 110, align: 'right' }, { label: 'Plan (TL, teklif kuru)', width: 110, align: 'right' }],
        rows: [
          ['Alış (maliyet)', eur(fx.cost.eur), try_(fx.cost.try), try_(r.plannedTry?.cost)],
          ['Satış', eur(fx.revenue.eur), try_(fx.revenue.try), try_(r.plannedTry?.sale)],
          ['Kâr', eur(fx.profit.eur), try_(fx.profit.try), try_(r.plannedTry?.profit)],
          ['Marj (Kâr ÷ Satış)', p(fx.margin.eur), p(fx.margin.try), '—'],
          ['Markup (Kâr ÷ Alış)', p(fx.markup.eur), p(fx.markup.try), '—'],
          ['Kur farkı (gerçekleşen − teklif kuru)', eur(fx.fxGainLoss.eur), try_(fx.fxGainLoss.try), '—'],
          ['Tahsilat günü - ödeme günü kur farkı', '—', try_(fx.collectionVsPaymentFx.try), '—'],
          ['Ort. tahsilat kuru (EUR/TL)', '', rate(fx.avgCollectionRate), ''],
          ['Ort. ödeme kuru (EUR/TL)', '', rate(fx.avgPaymentRate), ''],
          ['Proje ortalama kuru (EUR/TL)', '', rate(fx.projectAvgRate), rate(fx.quoteRate)],
        ],
      },
    },
    {
      kind: 'table',
      table: {
        title: 'Kanıt: para hareketleri (her biri kendi gerçek kuruyla)',
        columns: [{ label: 'Tarih / tür', width: 120 }, { label: 'Tutar', width: 95, align: 'right' }, { label: 'Kur / kaynak', width: 130 }, { label: 'EUR', width: 80, align: 'right' }, { label: 'TL', width: 80, align: 'right' }],
        rows: fx.evidence.map((e) => [
          `${e.date ?? '—'} ${TYPE_TR[e.type] ?? e.type}${e.usage === 'settled' ? ' (tahsil/ödendi)' : ''}`,
          money(e.amount, e.currency),
          `${rate(e.eurTryRate)} · ${e.rateNote ?? RATE_SOURCE_TR[e.rateSource] ?? e.rateSource}`,
          eur(e.eur), try_(e.try),
        ]),
      },
    },
    ...(fx.reasons.length ? [{ kind: 'text' as const, title: 'Eksik / kısmi', lines: fx.reasons.map((x) => x.message) }] : []),
  ];
}

// ------------------------------------------------------------------ registration
export function registerPhaseBDocuments(): void {
  registerDocumentGenerator('program', null, async (ctx, { projectId }) => {
    const { p, days, undated } = await buildProgram(ctx, projectId);
    if (!days.length && !undated.length) throw conflict('Program için etkinlik tarihi veya hizmet kalemi gerekli', 'PROGRAM_EMPTY');
    const content = {
      projectCode: p.code, title: p.title, venue: p.venue_name, pax: p.pax, startDate: p.start_date, endDate: p.end_date,
      days, undated,
    };
    const cols = [{ label: 'Hizmet', width: 85 }, { label: 'Açıklama', width: 190 }, { label: 'Tedarikçi', width: 120 }, { label: 'Miktar', width: 120 }];
    const pdf = await renderPdf({
      header: {
        agencyName: await tenantName(ctx), title: `Etkinlik programı — ${p.code}`, subtitle: p.title ?? undefined,
        meta: [['Müşteri', p.customer_name ?? '-'], ['Mekân', p.venue_name ?? '-'], ['Tarih', `${p.start_date ?? '?'} – ${p.end_date ?? '?'}`], ['Kişi', String(p.pax ?? '-')], ['Belge tarihi', isoDate(ctx.now())]],
      },
      sections: [
        ...days.map((d) => ({
          kind: 'table' as const,
          table: { title: d.label, columns: cols, rows: d.entries.length ? d.entries.map((e) => [e.kind, e.description + (e.notes ? ` (${e.notes})` : ''), e.supplier ?? '—', e.quantity]) : [['—', 'Planlanmış hizmet yok', '', '']] },
        })),
        ...(undated.length ? [{ kind: 'table' as const, table: { title: 'Tarihi belirsiz kalemler', columns: cols, rows: undated.map((e) => [e.kind, e.description, e.supplier ?? '—', e.quantity]) } }] : []),
      ],
      footerNote: `Program proje verisinden üretilmiştir (${p.code}); kalem / tarih değişince "eski" olarak işaretlenir.`,
    });
    // project-wide dependency: any project / item / quote / contract change marks the program stale
    return { content, pdf, fileName: `${p.code}-program.pdf`, deps: [] };
  });

  registerDocumentGenerator('rooming_list', null, async (ctx, { projectId }) => {
    const p = await getProjectRow(ctx, projectId);
    const { rows } = await ctx.db.query(
      `SELECT room_type, count(*)::int AS n, count(*) FILTER (WHERE consent_reuse AND consent_withdrawn_at IS NULL)::int AS consent,
              count(*) FILTER (WHERE anonymized_at IS NOT NULL)::int AS anon
         FROM guests WHERE project_id = $1 GROUP BY room_type ORDER BY room_type NULLS LAST`, [projectId]);
    if (!rows.length) throw conflict('Rooming list için misafir kaydı yok', 'NO_GUESTS');
    // KVKK: counts only — personal data is never copied into documents (the Excel is rendered live, role-gated)
    const content = {
      projectCode: p.code, template: 'rooming-standard-v1', piiStored: false,
      guestCount: rows.reduce((s, r) => s + r.n, 0), consentCount: rows.reduce((s, r) => s + r.consent, 0), anonymizedCount: rows.reduce((s, r) => s + r.anon, 0),
      byRoomType: Object.fromEntries(rows.map((r) => [r.room_type ?? '—', r.n])),
      download: `/api/projects/${projectId}/rooming-list.xlsx`,
    };
    return { content, deps: [] };
  });
}
