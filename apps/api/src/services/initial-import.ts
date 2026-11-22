// §8 İlk veri yükü — admin-only historical import: upload (XLSX via the zip guard / CSV) → staging (import_rows) →
// validation (domain normalizeImportRow + live-data checks) → MANUAL verification (per-row / bulk approve / reject, inline
// edit) → commit of approved rows into the live tables in ONE transaction (actor = the admin, import_batch_id on every row).
// Imported projects are `historical` (closed / lost, closed_at set): no active list, inbox, follow-up, ops-calendar or
// worker job picks them up, but similar projects / know-how, price-history medians, supplier scores and the rule-suggestion
// generator read them like any other closed project. Batches are never deleted: open → committed | abandoned.
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  IMPORT_COMMIT_ORDER, IMPORT_ENTITIES, IMPORT_TEMPLATES, cellText, historicalProjectCode, importNaturalKey, importWindowStart,
  localDate, matchHeaders, normalizeImportRow, normalizeName, parseCsv, rowStatus, slugTr, supplierScore,
  type ImportCell, type ImportEntity, type ImportIssue,
} from '@mice/domain';
import type { ImportBatch, ImportBatchDetail, ImportFile, ImportReviewRequest, ImportRow, ImportSummary } from '@mice/shared';
import type { Ctx } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { assertSafeZip } from '../lib/zip-guard.js';
import type { Row } from '../lib/mappers.js';
import { createDecision, decide } from './decisions.js';
import { currentFx, type FxSnapshot } from './fx.js';
import { projectRealizedFx } from './realized-fx.js';
import { nextSeq } from './projects.js';

export const MAX_IMPORT_ROWS = 5000;

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Admin only, human only: the initial load writes verified history that every later decision learns from. */
export function assertImportAdmin(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || ctx.user?.role !== 'admin') throw forbidden('Veri aktarımını yalnızca yönetici yapar', 'ADMIN_ONLY');
}

export function isImportEntity(e: string): e is ImportEntity {
  return (IMPORT_ENTITIES as readonly string[]).includes(e);
}

// ------------------------------------------------------------------ templates
export async function importTemplate(entity: ImportEntity, format: 'xlsx' | 'csv'): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const tpl = IMPORT_TEMPLATES[entity];
  if (format === 'csv') {
    const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const text = '﻿' + [tpl.columns.map((c) => esc(c.label)).join(';'), tpl.columns.map((c) => esc(c.example)).join(';')].join('\r\n') + '\r\n';
    return { fileName: `sablon-${entity}.csv`, mimeType: 'text/csv; charset=utf-8', data: Buffer.from(text, 'utf8') };
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tpl.sheet);
  ws.addRow(tpl.columns.map((c) => c.label)).font = { bold: true };
  ws.addRow(tpl.columns.map((c) => c.example));
  ws.columns.forEach((c) => { c.width = 22; });
  const help = wb.addWorksheet('Aciklama');
  help.addRow(['Sütun', 'Zorunlu', 'Açıklama']).font = { bold: true };
  for (const c of tpl.columns) help.addRow([c.label, c.required ? 'evet' : '', c.hint ?? '']);
  help.addRow([]);
  help.addRow(['Sayılar TR biçiminde (1.234,56) veya hücre sayısı; tarihler gg.aa.yyyy veya tarih hücresi. Yalnız ilk sayfa okunur; 2. satırdaki örneği silin.']);
  help.columns.forEach((c) => { c.width = 40; });
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return { fileName: `sablon-${entity}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data };
}

// ------------------------------------------------------------------ file parsing
export interface ImportUpload { filename: string; mimetype: string; buffer: Buffer }

function xlsxCell(v: unknown): ImportCell {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return xlsxCell(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((x) => x.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return null;
  }
  return String(v);
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Excel "CSV" on Turkish Windows → Windows-1254
    try {
      return new TextDecoder('windows-1254').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

export async function readImportFile(file: ImportUpload): Promise<ImportCell[][]> {
  const name = file.filename.toLowerCase();
  if (name.endsWith('.xlsx') || file.mimetype.includes('spreadsheetml')) {
    assertSafeZip(file.buffer); // G-18 zip-bomb guard before exceljs inflates anything
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: ImportCell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map(xlsxCell);
      if (vals.some((v) => v != null && String(v).trim() !== '')) out.push(vals);
    });
    return out;
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.mimetype.startsWith('text/') || file.mimetype === 'application/vnd.ms-excel') {
    return parseCsv(decodeText(file.buffer));
  }
  throw badRequest('Dosya XLSX veya CSV olmalı', { mimetype: file.mimetype }, 'UNSUPPORTED_FILE');
}

// ------------------------------------------------------------------ mapping
function mapBatch(r: Row): ImportBatch {
  return {
    id: r.id, label: r.label, status: r.status, summary: r.summary ?? {}, createdBy: r.created_by, createdAt: iso(r.created_at)!,
    committedAt: iso(r.committed_at), committedBy: r.committed_by, abandonedAt: iso(r.abandoned_at), abandonReason: r.abandon_reason,
  };
}
function mapFile(r: Row): ImportFile {
  return { id: r.id, entity: r.entity, fileName: r.file_name, rowCount: r.row_count, unknownHeaders: r.unknown_headers ?? [], createdAt: iso(r.created_at)! };
}
function mapRow(r: Row): ImportRow {
  return {
    id: r.id, fileId: r.file_id, entity: r.entity, rowNo: r.row_no, input: r.input ?? {}, data: r.data ?? {}, status: r.status,
    issues: r.issues ?? [], review: r.review, resolved: r.resolved ?? {}, committedEntityId: r.committed_entity_id ?? null,
    committedAction: r.committed_action ?? null,
  };
}

async function batchRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const r = (await ctx.db.query(`SELECT * FROM import_batches WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!r) throw notFound('Aktarım');
  return r;
}
function assertOpen(b: Row): void {
  if (b.status !== 'open') throw conflict(b.status === 'committed' ? 'Aktarım zaten işlendi' : 'Aktarımdan vazgeçildi', 'BATCH_CLOSED');
}

async function activeRows(ctx: Ctx, batchId: string): Promise<Row[]> {
  const order = `array_position(ARRAY['suppliers','customers','projects','service_lines','price_points','channel_prices','finance_movements'], r.entity)`;
  return (await ctx.db.query(
    `SELECT r.* FROM import_rows r JOIN import_files f ON f.id = r.file_id AND f.superseded_at IS NULL
      WHERE r.batch_id = $1 ORDER BY ${order}, r.row_no`, [batchId])).rows;
}

export async function getBatchDetail(ctx: Ctx, id: string): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  const b = await batchRow(ctx, id);
  const files = (await ctx.db.query('SELECT * FROM import_files WHERE batch_id = $1 AND superseded_at IS NULL ORDER BY created_at', [id])).rows;
  return { batch: mapBatch(b), files: files.map(mapFile), rows: (await activeRows(ctx, id)).map(mapRow) };
}

export async function listBatches(ctx: Ctx): Promise<ImportBatch[]> {
  assertImportAdmin(ctx);
  return (await ctx.db.query('SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 200')).rows.map(mapBatch);
}

export async function createBatch(ctx: Ctx, input: { label?: string }): Promise<ImportBatch> {
  assertImportAdmin(ctx);
  const { rows } = await ctx.db.query(
    `INSERT INTO import_batches (tenant_id, label, created_by) VALUES (app_tenant_id(), $1, $2) RETURNING *`, [input.label?.trim() || null, ctx.user!.id]);
  return mapBatch(rows[0]);
}

export async function abandonBatch(ctx: Ctx, id: string, reason?: string): Promise<ImportBatch> {
  assertImportAdmin(ctx);
  const b = await batchRow(ctx, id, true);
  assertOpen(b);
  const { rows } = await ctx.db.query(
    `UPDATE import_batches SET status = 'abandoned', abandoned_by = $2, abandoned_at = $3, abandon_reason = $4 WHERE id = $1 RETURNING *`,
    [id, ctx.user!.id, ctx.now(), reason?.trim() || null]);
  return mapBatch(rows[0]);
}

// ------------------------------------------------------------------ upload → staging
export async function addImportFile(ctx: Ctx, batchId: string, entity: ImportEntity, file: ImportUpload): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  const b = await batchRow(ctx, batchId, true);
  assertOpen(b);
  const sha = createHash('sha256').update(file.buffer).digest('hex');
  const same = (await ctx.db.query(
    `SELECT f.batch_id, b.status FROM import_files f JOIN import_batches b ON b.id = f.batch_id
      WHERE f.file_sha256 = $1 AND f.entity = $2 AND f.superseded_at IS NULL AND b.status <> 'abandoned'`, [sha, entity])).rows;
  // idempotent: the identical file is already staged in this batch → nothing new
  if (same.some((s) => s.batch_id === batchId)) return getBatchDetail(ctx, batchId);
  if (same.length) throw conflict('Bu dosya başka bir aktarımda zaten yüklü', 'DUPLICATE_FILE', { batchId: same[0].batch_id, status: same[0].status });

  const table = await readImportFile(file);
  if (!table.length) throw badRequest('Dosyada satır bulunamadı', undefined, 'EMPTY_FILE');
  const header = matchHeaders(entity, table[0]);
  if (header.missing.length) throw badRequest(`Zorunlu sütun eksik: ${header.missing.join(', ')}`, { missing: header.missing, unknown: header.unknown }, 'MISSING_COLUMNS');
  const body = table.slice(1);
  if (!body.length) throw badRequest('Başlık satırından sonra veri yok', undefined, 'EMPTY_FILE');
  if (body.length > MAX_IMPORT_ROWS) throw badRequest(`Bir dosya en fazla ${MAX_IMPORT_ROWS} satır içerebilir (${body.length}); dosyayı bölün`, undefined, 'FILE_TOO_LARGE');

  await ctx.db.query('UPDATE import_files SET superseded_at = $3 WHERE batch_id = $1 AND entity = $2 AND superseded_at IS NULL', [batchId, entity, ctx.now()]);
  const f = (await ctx.db.query(
    `INSERT INTO import_files (tenant_id, batch_id, entity, file_name, file_sha256, row_count, unknown_headers, uploaded_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [batchId, entity, file.filename.slice(0, 200), sha, body.length, header.unknown, ctx.user!.id])).rows[0];
  for (const [i, cells] of body.entries()) {
    const input: Record<string, ImportCell> = {};
    header.keys.forEach((k, j) => { if (k) input[k] = cells[j] ?? null; });
    const raw: Record<string, ImportCell> = {};
    table[0].forEach((h, j) => { raw[cellText(h) || `col${j + 1}`] = cells[j] ?? null; });
    await ctx.db.query(
      `INSERT INTO import_rows (tenant_id, batch_id, file_id, entity, row_no, raw, input) VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6)`,
      [batchId, f.id, entity, i + 2, JSON.stringify(raw), JSON.stringify(input)]);
  }
  await validateBatch(ctx, batchId);
  return getBatchDetail(ctx, batchId);
}

// ------------------------------------------------------------------ validation (row-level + live data)
interface Staged { rowId: string; usable: boolean; vkn: string | null; nameKey: string; cityKey?: string; data: Record<string, unknown> }
type Ref = { existingId: string } | { stagedRowId: string };

interface Lookup {
  fx: FxSnapshot;
  suppliers: Row[];
  customers: Row[];
  histProjects: Map<string, Row>;
  liveProjectKeys: Set<string>;
  histItemKeys: Set<string>;
  priceKeys: Set<string>;
  channelKeys: Set<string>;
}

const phKey = (supplierId: string, kind: unknown, date: unknown, unit: unknown, price: unknown, cur: unknown, room: unknown) =>
  [supplierId, kind, String(date).slice(0, 10), unit, Number(price).toFixed(2), cur, String(room ?? '').toUpperCase()].join('|');
const cpKey = (supplierId: string, date: unknown, room: unknown, board: unknown, canc: unknown, price: unknown, cur: unknown) =>
  [supplierId, String(date).slice(0, 10), String(room ?? '').toUpperCase(), String(board ?? '').toUpperCase(), canc, Number(price).toFixed(2), cur].join('|');
const itemKey = (projectId: string, kind: unknown, desc: unknown, date: unknown, qty: unknown) =>
  [projectId, kind, normalizeName(String(desc ?? '')), String(date ?? '').slice(0, 10), Number(qty).toFixed(2)].join('|');

async function loadLookup(ctx: Ctx, windowStart: string): Promise<Lookup> {
  const q = (sql: string, p: unknown[] = []) => ctx.db.query(sql, p).then((r) => r.rows);
  const hist = await q(`SELECT id, source_ref, outcome, start_date, pax, city, district FROM projects WHERE historical`);
  return {
    fx: await currentFx(ctx.db),
    suppliers: await q('SELECT id, name, tax_number, city, district, kinds, status, segment FROM suppliers'),
    customers: await q('SELECT id, name, tax_number, short_code FROM customers'),
    histProjects: new Map(hist.map((h) => [h.source_ref, h])),
    liveProjectKeys: new Set((await q(`SELECT customer_id, start_date FROM projects WHERE NOT historical AND customer_id IS NOT NULL AND start_date IS NOT NULL`))
      .map((r) => `${r.customer_id}|${r.start_date}`)),
    histItemKeys: new Set((await q(`SELECT si.project_id, si.kind, si.description, si.date_from, si.quantity FROM service_items si JOIN projects p ON p.id = si.project_id WHERE p.historical`))
      .map((r) => itemKey(r.project_id, r.kind, r.description, r.date_from, r.quantity))),
    priceKeys: new Set((await q(`SELECT supplier_id, kind, service_date, unit, unit_price, currency, room_type FROM price_history WHERE supplier_id IS NOT NULL AND service_date >= $1`, [windowStart]))
      .map((r) => phKey(r.supplier_id, r.kind, r.service_date, r.unit, r.unit_price, r.currency, r.room_type))),
    channelKeys: new Set((await q(`SELECT supplier_id, stay_date, room_type, board, cancellation, price, currency FROM channel_prices WHERE stay_date >= $1::date - 31`, [windowStart]))
      .map((r) => cpKey(r.supplier_id, r.stay_date, r.room_type, r.board, r.cancellation, r.price, r.currency))),
  };
}

function resolveParty(existing: Row[], staged: Staged[], vkn: string | null, name: string | null): { ref: Ref | null; ambiguous: boolean; label: string | null; stagedUnusable?: boolean } {
  if (vkn) {
    const e = existing.find((x) => x.tax_number && String(x.tax_number).replace(/\D/g, '') === vkn);
    if (e) return { ref: { existingId: e.id }, ambiguous: false, label: e.name };
    const s = staged.find((x) => x.vkn === vkn);
    if (s) return s.usable ? { ref: { stagedRowId: s.rowId }, ambiguous: false, label: String(s.data.name) } : { ref: null, ambiguous: false, label: null, stagedUnusable: true };
  }
  const key = normalizeName(name);
  if (!key) return { ref: null, ambiguous: false, label: null };
  const es = existing.filter((x) => normalizeName(x.name) === key);
  if (es.length > 1) return { ref: null, ambiguous: true, label: null };
  if (es.length === 1) return { ref: { existingId: es[0].id }, ambiguous: false, label: es[0].name };
  const ss = staged.filter((x) => x.nameKey === key);
  if (ss.length > 1) return { ref: null, ambiguous: true, label: null };
  if (ss.length === 1) return ss[0].usable ? { ref: { stagedRowId: ss[0].rowId }, ambiguous: false, label: String(ss[0].data.name) } : { ref: null, ambiguous: false, label: null, stagedUnusable: true };
  return { ref: null, ambiguous: false, label: null };
}

function emptySummary(): ImportSummary {
  return { rows: 0, ok: 0, warning: 0, error: 0, pending: 0, approved: 0, rejected: 0, byEntity: {} };
}

/** Re-runs every check for the batch's active rows (idempotent; only changed rows are written). */
export async function validateBatch(ctx: Ctx, batchId: string): Promise<ImportSummary> {
  const rules = await ctx.rules();
  const today = localDate(ctx.now(), rules.businessHours.timezone);
  const windowMonths = Number(rules.initialImportWindowMonths ?? 18);
  const windowStart = importWindowStart(today, windowMonths);
  const L = await loadLookup(ctx, windowStart);
  const rows = await activeRows(ctx, batchId);
  const staged: Record<'suppliers' | 'customers', Staged[]> = { suppliers: [], customers: [] };
  const stagedProjects = new Map<string, Staged>();
  const seenKeys = new Map<string, number>();
  const summary = emptySummary();
  summary.windowMonths = windowMonths;
  summary.windowStart = windowStart;

  for (const r of rows) {
    const entity = r.entity as ImportEntity;
    const { data, issues } = normalizeImportRow(entity, r.input ?? {}, { today, windowMonths });
    const resolved: Record<string, unknown> = {};
    const err = (code: string, message: string, field?: string) => issues.push({ code, severity: 'error', message, field });
    const warn = (code: string, message: string, field?: string) => issues.push({ code, severity: 'warning', message, field });
    const info = (code: string, message: string, field?: string) => issues.push({ code, severity: 'info', message, field });
    const nk = importNaturalKey(entity, data);
    const firstRow = seenKeys.get(`${entity}:${nk}`);
    if (firstRow != null) err('DUPLICATE_IN_FILE', `Dosyada mükerrer satır (satır ${firstRow} ile aynı)`);
    else seenKeys.set(`${entity}:${nk}`, r.row_no);
    const currencyKnown = (cur: unknown) => {
      if (cur && !L.fx.rates[String(cur)]) err('FX_MISSING', `${cur} için kur kaydı yok (EUR karşılığı hesaplanamaz)`, 'currency');
    };
    const supplierRef = (required: boolean) => {
      const name = (data.supplier as string | null) ?? null;
      const vkn = (data.supplierVkn as string | null) ?? null;
      if (!name && !vkn) return null;
      const res = resolveParty(L.suppliers, staged.suppliers, vkn, name);
      if (res.ambiguous) err('SUPPLIER_AMBIGUOUS', `Tedarikçi adı birden fazla kayıtla eşleşti: ${name} — VKN girin`, 'supplier');
      else if (res.stagedUnusable) err('SUPPLIER_NOT_USABLE', 'Bağlı tedarikçi satırı hatalı veya reddedildi', 'supplier');
      else if (!res.ref) {
        if (required || name || vkn) err('SUPPLIER_NOT_FOUND', `Tedarikçi bulunamadı: ${name ?? vkn} — tedarikçi dosyasına ekleyin veya adı düzeltin`, 'supplier');
      } else {
        resolved.supplier = { ...res.ref, name: res.label };
        if ('stagedRowId' in res.ref) info('SUPPLIER_IN_BATCH', `Tedarikçi bu aktarımdan: ${res.label}`, 'supplier');
      }
      return res.ref;
    };

    switch (entity) {
      case 'suppliers':
      case 'customers': {
        const existing = entity === 'suppliers' ? L.suppliers : L.customers;
        const vkn = (data.vkn as string | null) ?? null;
        const match = vkn ? existing.find((x) => x.tax_number && String(x.tax_number).replace(/\D/g, '') === vkn) : undefined;
        const byName = !match ? existing.filter((x) => normalizeName(x.name) === normalizeName(data.name as string)) : [];
        const hit = match ?? (byName.length === 1 ? byName[0] : undefined);
        if (byName.length > 1) err('AMBIGUOUS', 'Ad birden fazla mevcut kayıtla eşleşti — VKN girin');
        if (hit) {
          resolved.existingId = hit.id;
          warn('EXISTING_RECORD', `Mevcut kayıtla eşleşti (${match ? 'VKN' : 'ad'}): ${hit.name} — yeni kayıt açılmaz, bağlanır`);
          if (entity === 'suppliers' && data.accredit) warn('ACCREDIT_IGNORED', 'Mevcut tedarikçide akreditasyon karar kutusundan istenir; aktarım değiştirmez', 'accredit');
        }
        if (match && normalizeName(match.name) !== normalizeName(data.name as string)) warn('NAME_DIFFERS', `VKN eşleşti ama ad farklı (sistemde: ${match.name})`, 'name');
        break;
      }
      case 'projects': {
        const ref = slugTr(String(data.code ?? ''));
        if (ref && L.histProjects.has(ref)) err('ALREADY_IMPORTED', 'Bu proje kodu daha önce aktarıldı', 'code');
        if (data.customer || data.customerVkn) {
          const res = resolveParty(L.customers, staged.customers, (data.customerVkn as string | null) ?? null, (data.customer as string | null) ?? null);
          if (res.ambiguous) err('CUSTOMER_AMBIGUOUS', 'Müşteri adı birden fazla kayıtla eşleşti — VKN girin', 'customer');
          else if (res.stagedUnusable) err('CUSTOMER_NOT_USABLE', 'Bağlı müşteri satırı hatalı veya reddedildi', 'customer');
          else if (!res.ref) err('CUSTOMER_NOT_FOUND', `Müşteri bulunamadı: ${data.customer} — müşteri dosyasına ekleyin veya adı düzeltin`, 'customer');
          else {
            resolved.customer = { ...res.ref, name: res.label };
            if ('existingId' in res.ref && data.startDate && L.liveProjectKeys.has(`${res.ref.existingId}|${data.startDate}`)) {
              warn('POSSIBLE_DUPLICATE', 'Aynı müşteri ve başlangıç tarihli canlı bir proje var — mükerrer olabilir');
            }
          }
        }
        break;
      }
      case 'service_lines': {
        const code = slugTr(String(data.projectCode ?? ''));
        const sp = stagedProjects.get(code);
        let projectRef: Ref | null = null;
        if (sp) {
          if (!sp.usable) err('PROJECT_NOT_USABLE', 'Bağlı proje satırı hatalı veya reddedildi', 'project_code');
          else projectRef = { stagedRowId: sp.rowId };
        } else if (L.histProjects.has(code)) {
          const hp = L.histProjects.get(code)!;
          projectRef = { existingId: hp.id };
          if (L.histItemKeys.has(itemKey(hp.id, data.kind, data.description, data.dateFrom ?? hp.start_date, data.quantity))) err('ALREADY_IMPORTED', 'Bu kalem bu projeye daha önce aktarıldı');
          else info('PROJECT_EXISTING', 'Daha önce aktarılmış geçmiş projeye eklenir', 'project_code');
        } else if (code) err('PROJECT_NOT_FOUND', `Proje bulunamadı: ${data.projectCode} — proje dosyasına ekleyin`, 'project_code');
        if (projectRef) resolved.project = projectRef;
        supplierRef(false);
        currencyKnown(data.currency);
        break;
      }
      case 'finance_movements': {
        const code = slugTr(String(data.projectCode ?? ''));
        const sp = stagedProjects.get(code);
        if (sp) {
          if (!sp.usable) err('PROJECT_NOT_USABLE', 'Bağlı proje satırı hatalı veya reddedildi', 'project_code');
          else resolved.project = { stagedRowId: sp.rowId };
        } else if (L.histProjects.has(code)) {
          resolved.project = { existingId: L.histProjects.get(code)!.id };
          info('PROJECT_EXISTING', 'Daha önce aktarılmış geçmiş projeye eklenir', 'project_code');
        } else if (code) err('PROJECT_NOT_FOUND', `Proje bulunamadı: ${data.projectCode} — proje dosyasına ekleyin`, 'project_code');
        if (data.type === 'supplier_invoice' || data.type === 'payment') supplierRef(false);
        currencyKnown(data.currency);
        break;
      }
      case 'price_points':
      case 'channel_prices': {
        const sref = supplierRef(true);
        currencyKnown(data.currency);
        if (sref && 'existingId' in sref) {
          const dup = entity === 'price_points'
            ? L.priceKeys.has(phKey(sref.existingId, data.kind, data.date, data.unit, data.price, data.currency, data.roomType))
            : L.channelKeys.has(cpKey(sref.existingId, data.stayDate, data.roomType, data.board, data.cancellation, data.price, data.currency));
          if (dup) err('ALREADY_IMPORTED', 'Aynı fiyat kaydı sistemde zaten var');
          if (entity === 'channel_prices') {
            const s = L.suppliers.find((x) => x.id === sref.existingId);
            if (s && !(s.kinds ?? []).includes('accommodation')) warn('NOT_ACCOMMODATION', 'Kanal fiyatı yalnız konaklama tedarikçileri için anlamlı');
          }
        }
        break;
      }
    }

    const status = rowStatus(issues);
    // an approved row that became invalid must be reviewed again
    const review = status === 'error' && r.review === 'approved' ? 'pending' : r.review;
    const usable = status !== 'error' && review !== 'rejected';
    if (entity === 'suppliers' || entity === 'customers') {
      staged[entity].push({ rowId: r.id, usable, vkn: (data.vkn as string | null) ?? null, nameKey: normalizeName(data.name as string), data });
    } else if (entity === 'projects' && data.code) {
      const k = slugTr(String(data.code));
      if (!stagedProjects.has(k)) stagedProjects.set(k, { rowId: r.id, usable, vkn: null, nameKey: k, data });
    }
    const changed = JSON.stringify(data) !== JSON.stringify(r.data) || JSON.stringify(issues) !== JSON.stringify(r.issues)
      || JSON.stringify(resolved) !== JSON.stringify(r.resolved) || status !== r.status || review !== r.review || nk !== r.natural_key;
    if (changed && !r.committed_at) {
      await ctx.db.query(
        `UPDATE import_rows SET data = $2, issues = $3, resolved = $4, status = $5, review = $6, natural_key = $7 WHERE id = $1`,
        [r.id, JSON.stringify(data), JSON.stringify(issues), JSON.stringify(resolved), status, review, nk]);
    }
    summary.rows++;
    summary[status]++;
    summary[review as 'pending' | 'approved' | 'rejected']++;
    const e = (summary.byEntity[entity] ??= { rows: 0, ok: 0, warning: 0, error: 0, approved: 0, pending: 0 });
    e.rows++;
    e[status]++;
    if (review === 'approved') e.approved++;
    if (review === 'pending' && status !== 'error') e.pending++;
  }
  const prev = (await ctx.db.query('SELECT summary FROM import_batches WHERE id = $1', [batchId])).rows[0]?.summary ?? {};
  if (prev.committed) summary.committed = prev.committed;
  await ctx.db.query('UPDATE import_batches SET summary = $2 WHERE id = $1 AND status = $3', [batchId, JSON.stringify(summary), 'open']);
  return summary;
}

export async function revalidateBatch(ctx: Ctx, batchId: string): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  assertOpen(await batchRow(ctx, batchId, true));
  await validateBatch(ctx, batchId);
  return getBatchDetail(ctx, batchId);
}

// ------------------------------------------------------------------ manual verification
const EDIT_EXTRA_KEYS: Partial<Record<ImportEntity, string[]>> = { suppliers: ['accredit'] };

export async function editImportRow(ctx: Ctx, rowId: string, input: Record<string, unknown>): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  const r = (await ctx.db.query('SELECT * FROM import_rows WHERE id = $1', [rowId])).rows[0];
  if (!r) throw notFound('Aktarım satırı');
  assertOpen(await batchRow(ctx, r.batch_id, true));
  const allowed = new Set([...IMPORT_TEMPLATES[r.entity as ImportEntity].columns.map((c) => c.key), ...(EDIT_EXTRA_KEYS[r.entity as ImportEntity] ?? [])]);
  const next: Record<string, ImportCell> = { ...(r.input ?? {}) };
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) throw badRequest(`Bilinmeyen alan: ${k}`, undefined, 'UNKNOWN_FIELD');
    if (v != null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw badRequest(`Geçersiz değer: ${k}`, undefined, 'INVALID_VALUE');
    next[k] = v == null ? null : typeof v === 'boolean' ? (v ? 'evet' : '') : typeof v === 'string' ? v.slice(0, 2000) : v;
  }
  // any change needs a fresh human approval
  await ctx.db.query(
    `UPDATE import_rows SET input = $2, review = 'pending', edited_by = $3, edited_at = $4 WHERE id = $1`,
    [rowId, JSON.stringify(next), ctx.user!.id, ctx.now()]);
  await validateBatch(ctx, r.batch_id);
  return getBatchDetail(ctx, r.batch_id);
}

export async function reviewImportRows(ctx: Ctx, batchId: string, req: ImportReviewRequest): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  assertOpen(await batchRow(ctx, batchId, true));
  if (!req.rowIds?.length && !req.statuses?.length) throw badRequest('rowIds veya statuses gerekli', undefined, 'NO_SELECTION');
  const target = (await activeRows(ctx, batchId)).filter((r) =>
    (!req.rowIds?.length || req.rowIds.includes(r.id)) && (!req.statuses?.length || req.statuses.includes(r.status)) && (!req.entity || r.entity === req.entity)
    // bulk (by status) only touches undecided rows: an explicit per-row decision is never overridden in bulk
    && (req.rowIds?.length || req.action === 'reset' || r.review === 'pending'));
  if (req.action === 'approve') {
    const bad = target.filter((r) => r.status === 'error');
    if (req.rowIds?.length && bad.length) throw conflict('Hatalı satırlar onaylanamaz; önce düzeltin', 'ROW_HAS_ERRORS', { rowIds: bad.map((r) => r.id) });
  }
  const review = req.action === 'approve' ? 'approved' : req.action === 'reject' ? 'rejected' : 'pending';
  const ids = target.filter((r) => !(req.action === 'approve' && r.status === 'error')).map((r) => r.id);
  if (ids.length) {
    await ctx.db.query(`UPDATE import_rows SET review = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = ANY($1) AND committed_at IS NULL`,
      [ids, review, ctx.user!.id, ctx.now()]);
  }
  await validateBatch(ctx, batchId);
  return getBatchDetail(ctx, batchId);
}

// ------------------------------------------------------------------ commit
/** Distinct projects a supplier worked on: contracts + historical imported service lines (feeds supplierScore). */
export async function supplierProjectCount(ctx: Ctx, supplierId: string): Promise<number> {
  return Number((await ctx.db.query(
    `SELECT count(DISTINCT project_id)::int AS n FROM (
       SELECT project_id FROM contracts WHERE supplier_id = $1
       UNION SELECT si.project_id FROM service_items si JOIN projects p ON p.id = si.project_id
              WHERE p.historical AND si.specs->'historical'->>'supplierId' = $1::text) x`, [supplierId])).rows[0].n);
}

async function refreshSupplierScore(ctx: Ctx, sid: string): Promise<boolean> {
  // only suppliers with a computed basis (signed contracts) are rescored; history adds to the project denominator
  const contracts = Number((await ctx.db.query('SELECT count(*)::int AS n FROM contracts WHERE supplier_id = $1', [sid])).rows[0].n);
  if (!contracts) return false;
  const s = (await ctx.db.query('SELECT avg_response_hours FROM suppliers WHERE id = $1', [sid])).rows[0];
  const n = async (sql: string) => Number((await ctx.db.query(sql, [sid])).rows[0].n);
  const score = supplierScore({
    avgResponseHours: s?.avg_response_hours != null ? Number(s.avg_response_hours) : null,
    contractErrors: await n(`SELECT COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(c.diff) x WHERE x->>'severity' = 'error')), 0)::int AS n FROM contracts c WHERE c.supplier_id = $1`),
    fieldIssues: await n('SELECT count(*)::int AS n FROM field_issues WHERE supplier_id = $1'),
    invoiceMismatches: await n(`SELECT count(*)::int AS n FROM finance_entries WHERE supplier_id = $1 AND kind = 'supplier_invoice' AND (meta->>'mismatch')::boolean`),
    projects: await supplierProjectCount(ctx, sid),
  });
  await ctx.db.query('UPDATE suppliers SET performance_score = $2 WHERE id = $1', [sid, score]);
  return true;
}

const seasonOf = (date: string | null) => {
  if (!date) return null;
  const m = Number(date.slice(5, 7));
  return m >= 4 && m <= 10 ? 'high' : 'low';
};

export async function commitBatch(ctx: Ctx, batchId: string): Promise<ImportBatchDetail> {
  assertImportAdmin(ctx);
  const user = ctx.user!;
  const b = await batchRow(ctx, batchId, true);
  assertOpen(b);
  await validateBatch(ctx, batchId);
  const rows = await activeRows(ctx, batchId);
  const pending = rows.filter((r) => r.status !== 'error' && r.review === 'pending');
  if (pending.length) throw conflict(`${pending.length} satır henüz doğrulanmadı (onayla / reddet)`, 'ROWS_PENDING', { count: pending.length });
  const approved = rows.filter((r) => r.review === 'approved' && r.status !== 'error');
  if (!approved.length) throw conflict('Onaylanmış satır yok', 'NOTHING_APPROVED');
  const approvedIds = new Set(approved.map((r) => r.id));
  const missingDeps: { rowId: string; entity: string; rowNo: number; dependsOn: string }[] = [];
  for (const r of approved) {
    for (const k of ['supplier', 'customer', 'project']) {
      const ref = (r.resolved ?? {})[k] as { stagedRowId?: string } | undefined;
      if (ref?.stagedRowId && !approvedIds.has(ref.stagedRowId)) missingDeps.push({ rowId: r.id, entity: r.entity, rowNo: r.row_no, dependsOn: ref.stagedRowId });
    }
  }
  if (missingDeps.length) throw conflict('Onaylı satırlar onaylanmamış satırlara bağlı (tedarikçi / müşteri / proje)', 'DEPENDENCY_NOT_APPROVED', missingDeps);

  const fx = await currentFx(ctx.db);
  const eur = (amount: number, cur: string) => amount / (fx.rates[cur] ?? NaN);
  const idMap = new Map<string, string>();
  const live = (ref: unknown): string | null => {
    const x = ref as { existingId?: string; stagedRowId?: string } | undefined;
    return x?.existingId ?? (x?.stagedRowId ? idMap.get(x.stagedRowId) ?? null : null);
  };
  const committed: NonNullable<ImportSummary['committed']> = {};
  const touchedSuppliers = new Set<string>();
  const movementProjects = new Set<string>();
  const accredit: { id: string; name: string }[] = [];
  const mark = async (r: Row, id: string, action: 'created' | 'linked') => {
    idMap.set(r.id, id);
    const c = (committed[r.entity as ImportEntity] ??= { created: 0, linked: 0 });
    c[action]++;
    await ctx.db.query('UPDATE import_rows SET committed_entity_id = $2, committed_action = $3, committed_at = $4 WHERE id = $1', [r.id, id, action, ctx.now()]);
  };
  const byEntity = (e: ImportEntity) => approved.filter((r) => r.entity === e);

  // project totals from the approved lines (EUR at the current recorded rate)
  const lineTotals = new Map<string, { cost: number; sale: number }>();
  for (const l of byEntity('service_lines')) {
    const d = l.data;
    const key = (l.resolved.project?.stagedRowId ?? l.resolved.project?.existingId) as string;
    const mult = Number(d.quantity) * Math.max(1, Number(d.nights ?? 0) || 1);
    const t = lineTotals.get(key) ?? { cost: 0, sale: 0 };
    t.cost += eur(Number(d.unitCost ?? 0) * mult, d.currency);
    t.sale += eur(Number(d.unitSale ?? 0) * mult, d.currency);
    lineTotals.set(key, t);
  }

  for (const entity of IMPORT_COMMIT_ORDER) {
    for (const r of byEntity(entity)) {
      const d = r.data;
      switch (entity) {
        case 'suppliers': {
          if (r.resolved.existingId) { await mark(r, r.resolved.existingId, 'linked'); break; }
          const s = (await ctx.db.query(
            `INSERT INTO suppliers (tenant_id, name, kinds, city, district, status, segment, email, phone, contact_name, capacity_pax, room_count,
               payment_terms, tax_number, created_by, import_batch_id)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, name`,
            [d.name, d.kinds, d.city, d.district, d.status, d.segment, d.email, d.phone, d.contactName, d.capacityPax, d.roomCount, d.paymentTerms,
              d.vkn, user.id, batchId])).rows[0];
          if (d.accredit) accredit.push(s);
          await mark(r, s.id, 'created');
          break;
        }
        case 'customers': {
          if (r.resolved.existingId) { await mark(r, r.resolved.existingId, 'linked'); break; }
          const contacts = d.contactName || d.contactEmail || d.contactPhone
            ? [{ name: d.contactName ?? '', ...(d.contactEmail ? { email: d.contactEmail } : {}), ...(d.contactPhone ? { phone: d.contactPhone } : {}) }] : [];
          const c = (await ctx.db.query(
            `INSERT INTO customers (tenant_id, name, short_code, tax_office, tax_number, billing_address, contacts, import_batch_id)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [d.name, d.shortCode, d.taxOffice, d.vkn, d.billingAddress, JSON.stringify(contacts), batchId])).rows[0];
          await mark(r, c.id, 'created');
          break;
        }
        case 'projects': {
          const customerId = live(r.resolved.customer);
          const cust = customerId ? (await ctx.db.query('SELECT name FROM customers WHERE id = $1', [customerId])).rows[0] : null;
          const totals = lineTotals.get(r.id);
          const closed = (d.closedDate ?? d.endDate ?? d.startDate) as string;
          const seq = -(await nextSeq(ctx, 'historical_project'));
          const p = (await ctx.db.query(
            `INSERT INTO projects (tenant_id, seq, code, customer_id, customer_name, title, event_type, start_date, end_date, pax, city, district,
               venue_name, step, outcome, lost_reason, received_at, event_ended_at, closed_at, lessons_learned, created_by,
               historical, import_batch_id, source_ref, historical_cost_eur, historical_sale_eur)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, 8, $13,$14, $15::date, $16::date + 1, ($17::date + time '18:00') AT TIME ZONE 'Europe/Istanbul',
               $18, $19, true, $20, $21, $22, $23) RETURNING id`,
            [seq, historicalProjectCode(String(d.code)), customerId, cust?.name ?? d.customer,
              d.title ?? `${d.eventType ?? 'Proje'} — ${cust?.name ?? d.customer}`, d.eventType, d.startDate, d.endDate, d.pax, d.city, d.district, d.venue,
              d.outcome === 'won' ? 'closed' : 'lost', d.outcome === 'lost' ? d.lostReason : null, d.startDate, d.endDate ?? d.startDate, closed,
              d.notes, user.id, batchId, slugTr(String(d.code)), totals ? r2(totals.cost) : null, totals ? r2(totals.sale) : null])).rows[0];
          await mark(r, p.id, 'created');
          break;
        }
        case 'service_lines': {
          const projectId = live(r.resolved.project)!;
          const p = (await ctx.db.query('SELECT id, outcome, start_date, city, district, pax FROM projects WHERE id = $1', [projectId])).rows[0];
          const supplierId = live(r.resolved.supplier);
          const unitCostEur = eur(Number(d.unitCost ?? 0), d.currency);
          const unitSaleEur = eur(Number(d.unitSale ?? 0), d.currency);
          const won = p.outcome === 'closed';
          const dateFrom = (d.dateFrom ?? p.start_date) as string | null;
          const si = (await ctx.db.query(
            `INSERT INTO service_items (tenant_id, project_id, kind, description, date_from, date_to, quantity, unit, nights, specs, value_add, status, sort, import_batch_id)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [projectId, d.kind, d.description, dateFrom, d.dateTo, d.quantity, d.unit, d.nights,
              JSON.stringify({ historical: { supplierId, currency: d.currency, unitCost: d.unitCost, unitSale: d.unitSale, unitCostEur: r2(unitCostEur), unitSaleEur: r2(unitSaleEur), roomType: d.roomType, board: d.board } }),
              d.valueAdd === true, won ? 'confirmed' : 'offered', r.row_no, batchId])).rows[0];
          if (r.resolved.project?.existingId) {
            const mult = Number(d.quantity) * Math.max(1, Number(d.nights ?? 0) || 1);
            await ctx.db.query(
              `UPDATE projects SET historical_cost_eur = COALESCE(historical_cost_eur, 0) + $2, historical_sale_eur = COALESCE(historical_sale_eur, 0) + $3 WHERE id = $1`,
              [projectId, r2(unitCostEur * mult), r2(unitSaleEur * mult)]);
          }
          if (supplierId && Number(d.unitCost) > 0) {
            const s = (await ctx.db.query('SELECT city, district, segment FROM suppliers WHERE id = $1', [supplierId])).rows[0];
            // won → realized cost; lost → the negotiated price that was offered (not realized)
            await ctx.db.query(
              `INSERT INTO price_history (tenant_id, supplier_id, project_id, service_item_id, kind, description, city, district, segment, season, service_date, pax,
                 room_type, board, unit, price_type, unit_price, currency, unit_price_eur, verified, import_batch_id, created_at)
               VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, true, $19, COALESCE($10::date::timestamptz, now()))`,
              [supplierId, projectId, si.id, d.kind, d.description, p.city ?? s?.city, p.district ?? s?.district, s?.segment ?? null, seasonOf(dateFrom), dateFrom, p.pax,
                d.roomType, d.board, d.unit, won ? 'realized' : 'negotiated', d.unitCost, d.currency, r2(unitCostEur), batchId]);
            touchedSuppliers.add(supplierId);
          }
          await mark(r, si.id, 'created');
          break;
        }
        case 'price_points': {
          const supplierId = live(r.resolved.supplier)!;
          const s = (await ctx.db.query('SELECT city, district, segment FROM suppliers WHERE id = $1', [supplierId])).rows[0];
          const ph = (await ctx.db.query(
            `INSERT INTO price_history (tenant_id, supplier_id, kind, description, city, district, segment, season, service_date, pax, room_type, board, cancellation,
               unit, price_type, unit_price, currency, unit_price_eur, verified, import_batch_id, created_at)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'realized',$14,$15,$16, true, $17, $8::date::timestamptz) RETURNING id`,
            [supplierId, d.kind, d.description ?? `${d.kind} (geçmiş aktarım)`, s?.city, s?.district, s?.segment ?? null, seasonOf(d.date), d.date, d.pax,
              d.roomType, d.board, d.cancellation, d.unit, d.price, d.currency, r2(eur(Number(d.price), d.currency)), batchId])).rows[0];
          await mark(r, ph.id, 'created');
          break;
        }
        case 'finance_movements': {
          // Q5: historical money movement with its actual rate; closed bookkeeping (status matched → never a bank-match candidate,
          // invoice no kept in meta → never re-exported to Mikro)
          const projectId = live(r.resolved.project)!;
          const kind = { customer_invoice: 'customer_invoice', supplier_invoice: 'supplier_invoice', collection: 'payment_in', payment: 'payment_out' }[d.type as string]!;
          const proven = d.currency === 'EUR' ? d.eurTryRate != null : d.eurRate != null || d.eurTryRate != null;
          const sysRate = Number(d.eurRate ?? fx.rates[d.currency] ?? NaN);
          const fe = (await ctx.db.query(
            `INSERT INTO finance_entries (tenant_id, project_id, supplier_id, kind, amount, currency, fx_rate, amount_eur, status, reference, meta, created_by,
               actual_fx_rate, eur_try_rate, rate_source, value_date)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,'matched',$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [projectId, live(r.resolved.supplier), kind, d.amount, d.currency, sysRate, r2(Number(d.amount) / sysRate), `H-import`,
              JSON.stringify({ invoiceNo: d.docNo ?? null, settlesDocNo: d.settlesDocNo ?? null, importBatchId: batchId, historical: true, issueDate: d.date }),
              user.id, d.currency === 'EUR' ? 1 : d.eurRate ?? null, d.eurTryRate ?? null, proven ? 'import' : null, d.date])).rows[0];
          movementProjects.add(projectId);
          await mark(r, fe.id, 'created');
          break;
        }
        case 'channel_prices': {
          const supplierId = live(r.resolved.supplier)!;
          const cp = (await ctx.db.query(
            `INSERT INTO channel_prices (tenant_id, supplier_id, stay_date, room_type, board, cancellation, price, currency, price_eur, source, captured_by, captured_at, import_batch_id)
             VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::date::timestamptz, now()), $12) RETURNING id`,
            [supplierId, d.stayDate, d.roomType, d.board, d.cancellation, d.price, d.currency, r2(eur(Number(d.price), d.currency)), d.source, user.id, d.capturedAt, batchId])).rows[0];
          await mark(r, cp.id, 'created');
          break;
        }
      }
    }
  }

  // Q5: cash ↔ invoice links by document no, then the historical totals from the evidence (instead of today's FX)
  for (const projectId of movementProjects) {
    const ents = (await ctx.db.query(`SELECT id, kind, meta FROM finance_entries WHERE project_id = $1 AND meta->>'importBatchId' = $2`, [projectId, batchId])).rows;
    for (const c of ents.filter((e) => ['payment_in', 'payment_out'].includes(e.kind) && e.meta?.settlesDocNo)) {
      const invKind = c.kind === 'payment_in' ? 'customer_invoice' : 'supplier_invoice';
      const inv = ents.find((e) => e.kind === invKind && String(e.meta?.invoiceNo ?? '').toUpperCase() === String(c.meta.settlesDocNo).toUpperCase());
      if (inv) await ctx.db.query(`UPDATE finance_entries SET meta = meta || $2 WHERE id = $1`, [c.id, JSON.stringify({ settlesEntryId: inv.id })]);
    }
    const rf = await projectRealizedFx(ctx, projectId);
    const eurGap = (side: 'revenue' | 'cost') => rf.missingRates.some((m) => m.need.includes('EUR') && ((side === 'revenue') === ['customer_invoice', 'collection'].includes(m.type)));
    await ctx.db.query(
      `UPDATE projects SET historical_sale_eur = COALESCE($2, historical_sale_eur), historical_cost_eur = COALESCE($3, historical_cost_eur) WHERE id = $1`,
      [projectId, rf.revenue.eur != null && !eurGap('revenue') ? rf.revenue.eur : null, rf.cost.eur != null && !eurGap('cost') ? rf.cost.eur : null]);
  }

  // §6 / invariant 5: accreditation still goes through the decision box — an admin-only card decided by this admin
  const effects: string[] = [];
  for (const s of accredit) {
    const dec = await createDecision(ctx, {
      kind: 'supplier_accreditation', badge: 'suggestion', summary: `${s.name} akredite edilsin mi? (ilk veri yükü)`,
      detail: { supplierId: s.id, name: s.name, importBatchId: batchId }, requiredRole: 'admin', entityType: 'supplier', entityId: s.id,
    });
    const res = await decide(ctx, dec.id, { action: 'approve', reason: 'İlk veri yükü doğrulama ekranında yönetici akredite etti' });
    effects.push(...res.effects);
  }
  let rescored = 0;
  for (const sid of touchedSuppliers) if (await refreshSupplierScore(ctx, sid)) rescored++;

  const summary = { ...(b.summary ?? {}), committed, effects, rescoredSuppliers: rescored };
  await ctx.db.query(
    `UPDATE import_batches SET status = 'committed', committed_by = $2, committed_at = $3, summary = $4 WHERE id = $1`,
    [batchId, user.id, ctx.now(), JSON.stringify(summary)]);
  return getBatchDetail(ctx, batchId);
}

export type { ImportIssue };
