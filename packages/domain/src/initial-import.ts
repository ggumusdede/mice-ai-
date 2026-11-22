// §8 "İlk veri yükü" — pure rules for the initial historical import: template columns, header matching, CSV parsing,
// per-row normalization (TR number / date formats) and row-level validation (required fields, 18-month window, enums,
// cost ≤ sale sanity). Database-dependent checks (duplicates vs live data, supplier / customer resolution, FX) live in
// apps/api/src/services/initial-import.ts. Nothing here touches I/O.
import { CURRENCIES, SERVICE_KINDS, type ServiceKind } from '@mice/shared';
import { parseTrDate, parseTrNumber } from './bank-matching.js';
import { slugTr } from './project-code.js';
import { deriveMovementRates } from './realized-fx.js';

export const IMPORT_ENTITIES = ['suppliers', 'customers', 'projects', 'service_lines', 'price_points', 'channel_prices', 'finance_movements'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];
/** Commit order: referenced rows first. */
export const IMPORT_COMMIT_ORDER: readonly ImportEntity[] = IMPORT_ENTITIES;

export type ImportCell = string | number | null;
export type ImportSeverity = 'error' | 'warning' | 'info';
export interface ImportIssue { code: string; severity: ImportSeverity; message: string; field?: string }
export type ImportRowStatus = 'ok' | 'warning' | 'error';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** header aliases (compared after slugTr) */
  aliases?: string[];
  example: string;
  hint?: string;
}

export interface ImportTemplate { entity: ImportEntity; title: string; sheet: string; columns: ImportColumn[] }

const col = (key: string, label: string, example: string, o: Partial<ImportColumn> = {}): ImportColumn => ({ key, label, example, ...o });

export const IMPORT_TEMPLATES: Record<ImportEntity, ImportTemplate> = {
  suppliers: {
    entity: 'suppliers', title: 'Tedarikçiler', sheet: 'Tedarikciler', columns: [
      col('name', 'Tedarikçi adı', 'Moda Sahil Otel', { required: true, aliases: ['ad', 'unvan', 'tedarikci', 'firma'] }),
      col('vkn', 'VKN', '1234567890', { aliases: ['vergi no', 'vergi numarasi', 'tckn', 'vkn tckn'], hint: '10 haneli VKN veya 11 haneli TCKN' }),
      col('city', 'Şehir', 'İstanbul', { required: true, aliases: ['il', 'sehir'] }),
      col('district', 'Semt', 'Kadıköy', { aliases: ['ilce', 'semt ilce', 'bolge'] }),
      col('kinds', 'Hizmet türleri', 'konaklama, salon, yiyecek-içecek', { required: true, aliases: ['tur', 'turler', 'hizmet turu', 'kinds'], hint: 'konaklama, salon, yiyecek-içecek, transfer, teknik, aktivite, bilet, diğer (virgülle)' }),
      col('status', 'Statü', 'aday', { aliases: ['durum', 'statu'], hint: 'aday / akredite / pasif — akreditasyonu yalnız yönetici doğrulama ekranında verir' }),
      col('segment', 'Segment', '4*'),
      col('email', 'E-posta', 'satis@otel.example.com', { aliases: ['eposta', 'mail'] }),
      col('phone', 'Telefon', '+90 216 555 00 00', { aliases: ['tel'] }),
      col('contact_name', 'Yetkili', 'Satış Müdürü', { aliases: ['kontak', 'ilgili kisi'] }),
      col('capacity_pax', 'Kapasite (kişi)', '250', { aliases: ['kapasite'] }),
      col('room_count', 'Oda sayısı', '120', { aliases: ['oda'] }),
      col('payment_terms', 'Ödeme koşulu', '%30 ön ödeme', { aliases: ['odeme kosullari'] }),
    ],
  },
  customers: {
    entity: 'customers', title: 'Müşteriler', sheet: 'Musteriler', columns: [
      col('name', 'Müşteri adı', 'Anadolu İlaç A.Ş.', { required: true, aliases: ['ad', 'unvan', 'musteri', 'firma'] }),
      col('short_code', 'Kısa kod', 'ANADOLUILAC', { aliases: ['kod', 'kisa ad'], hint: 'boşsa addan üretilir' }),
      col('vkn', 'VKN', '1112223334', { aliases: ['vergi no', 'vergi numarasi', 'tckn'] }),
      col('tax_office', 'Vergi dairesi', 'Kozyatağı', { aliases: ['vd'] }),
      col('billing_address', 'Fatura adresi', 'Kozyatağı Mah. No:1 Kadıköy/İstanbul', { aliases: ['adres'] }),
      col('contact_name', 'Yetkili', 'Selin Aydın', { aliases: ['kontak', 'ilgili kisi'] }),
      col('contact_email', 'Yetkili e-posta', 'selin@example.com', { aliases: ['eposta', 'mail'] }),
      col('contact_phone', 'Yetkili telefon', '+90 532 000 00 00', { aliases: ['telefon', 'tel'] }),
    ],
  },
  projects: {
    entity: 'projects', title: 'Kapanmış projeler', sheet: 'Projeler', columns: [
      col('code', 'Proje kodu', '2025-034', { required: true, aliases: ['kod', 'eski kod', 'referans'], hint: 'eski sistemdeki kod; sistemde H-<kod> olarak saklanır' }),
      col('title', 'Başlık', 'Bayi toplantısı', { aliases: ['proje adi', 'etkinlik'] }),
      col('customer', 'Müşteri', 'Anadolu İlaç A.Ş.', { required: true, aliases: ['musteri adi', 'firma'] }),
      col('customer_vkn', 'Müşteri VKN', '1112223334', { aliases: ['musteri vergi no'] }),
      col('event_type', 'Etkinlik türü', 'toplantı', { aliases: ['tur', 'etkinlik turu'] }),
      col('start_date', 'Başlangıç', '12.03.2026', { required: true, aliases: ['baslangic tarihi', 'tarih'] }),
      col('end_date', 'Bitiş', '14.03.2026', { aliases: ['bitis tarihi'] }),
      col('closed_date', 'Kapanış tarihi', '30.03.2026', { aliases: ['kapanis'], hint: 'boşsa bitiş tarihi; pencere kuralı bu tarihe bakar' }),
      col('pax', 'Kişi', '80', { aliases: ['kisi sayisi', 'pax'] }),
      col('city', 'Şehir', 'İstanbul', { aliases: ['il'] }),
      col('district', 'Semt', 'Kadıköy', { aliases: ['ilce'] }),
      col('venue', 'Mekân', 'Moda Sahil Otel', { aliases: ['mekan', 'tesis', 'otel'] }),
      col('outcome', 'Sonuç', 'kazanıldı', { required: true, aliases: ['durum', 'sonuc'], hint: 'kazanıldı / kaybedildi' }),
      col('lost_reason', 'Kayıp nedeni', '', { aliases: ['kayip nedeni', 'neden'], hint: 'kaybedildi ise zorunlu' }),
      col('notes', 'Notlar / öğrenilenler', '', { aliases: ['not', 'notlar', 'ogrenilenler'] }),
    ],
  },
  service_lines: {
    entity: 'service_lines', title: 'Proje hizmet kalemleri', sheet: 'Kalemler', columns: [
      col('project_code', 'Proje kodu', '2025-034', { required: true, aliases: ['kod', 'proje'] }),
      col('kind', 'Tür', 'konaklama', { required: true, aliases: ['hizmet turu', 'tur'] }),
      col('description', 'Açıklama', 'Oda (DBL, BB)', { required: true, aliases: ['kalem', 'aciklama'] }),
      col('supplier', 'Tedarikçi', 'Moda Sahil Otel', { aliases: ['tedarikci adi'] }),
      col('supplier_vkn', 'Tedarikçi VKN', '', { aliases: ['tedarikci vergi no'] }),
      col('date_from', 'Tarih (başlangıç)', '12.03.2026', { aliases: ['tarih', 'baslangic'] }),
      col('date_to', 'Tarih (bitiş)', '14.03.2026', { aliases: ['bitis'] }),
      col('quantity', 'Miktar', '25', { required: true, aliases: ['adet'] }),
      col('unit', 'Birim', 'oda/gece', { required: true, hint: 'oda/gece, gün, kişi/gün, kişi, araç, götürü' }),
      col('nights', 'Gece', '2', { aliases: ['gece sayisi'] }),
      col('currency', 'Para birimi', 'EUR', { required: true, aliases: ['doviz', 'pb'] }),
      col('unit_cost', 'Birim alış (KDV hariç)', '105,00', { required: true, aliases: ['alis', 'birim alis', 'maliyet'] }),
      col('unit_sale', 'Birim satış (KDV hariç)', '126,00', { required: true, aliases: ['satis', 'birim satis'] }),
      col('room_type', 'Oda tipi', 'DBL', { aliases: ['oda'] }),
      col('board', 'Pansiyon', 'BB'),
    ],
  },
  price_points: {
    entity: 'price_points', title: 'Tedarikçi fiyat geçmişi', sheet: 'Fiyatlar', columns: [
      col('supplier', 'Tedarikçi', 'Moda Sahil Otel', { required: true, aliases: ['tedarikci adi'] }),
      col('supplier_vkn', 'Tedarikçi VKN', '', { aliases: ['tedarikci vergi no', 'vkn'] }),
      col('date', 'Hizmet tarihi', '12.03.2026', { required: true, aliases: ['tarih'] }),
      col('kind', 'Tür', 'salon', { required: true, aliases: ['hizmet turu'] }),
      col('description', 'Açıklama', 'Toplantı salonu (tiyatro)', { aliases: ['aciklama', 'kalem'] }),
      col('unit', 'Birim', 'gün', { required: true }),
      col('price', 'Birim fiyat (KDV hariç)', '1.300,00', { required: true, aliases: ['fiyat', 'net fiyat'] }),
      col('currency', 'Para birimi', 'EUR', { required: true, aliases: ['doviz', 'pb'] }),
      col('room_type', 'Oda tipi', '', { aliases: ['oda'] }),
      col('board', 'Pansiyon', ''),
      col('cancellation', 'İptal koşulu', 'esnek', { aliases: ['iptal'], hint: 'esnek / iadesiz' }),
      col('pax', 'Kişi', '80', { aliases: ['kisi sayisi'] }),
    ],
  },
  channel_prices: {
    entity: 'channel_prices', title: 'Kanal (OTA) fiyatları', sheet: 'KanalFiyatlari', columns: [
      col('supplier', 'Tedarikçi', 'Moda Sahil Otel', { required: true, aliases: ['otel', 'tedarikci adi'] }),
      col('supplier_vkn', 'Tedarikçi VKN', '', { aliases: ['vkn'] }),
      col('stay_date', 'Konaklama tarihi', '12.03.2026', { required: true, aliases: ['tarih', 'gece'] }),
      col('room_type', 'Oda tipi', 'DBL', { required: true, aliases: ['oda'] }),
      col('board', 'Pansiyon', 'BB', { required: true }),
      col('cancellation', 'İptal koşulu', 'esnek', { required: true, aliases: ['iptal'], hint: 'esnek / iadesiz' }),
      col('price', 'Fiyat', '125,00', { required: true, aliases: ['kanal fiyati'] }),
      col('currency', 'Para birimi', 'EUR', { required: true, aliases: ['doviz', 'pb'] }),
      col('source', 'Kaynak', 'Booking.com', { aliases: ['kanal'] }),
      col('captured_at', 'Kayıt tarihi', '01.02.2026', { aliases: ['alinma tarihi'] }),
    ],
  },
  // Q5 (optional): invoices / collections / payments of historical projects with their ACTUAL rate → evidence-based EUR + TL profit
  finance_movements: {
    entity: 'finance_movements', title: 'Finansal hareketler (geçmiş projeler)', sheet: 'FinansalHareketler', columns: [
      col('project_code', 'Proje kodu', '2025-034', { required: true, aliases: ['kod', 'proje'] }),
      col('type', 'Hareket türü', 'tahsilat', { required: true, aliases: ['tur', 'hareket'], hint: 'müşteri faturası / tedarikçi faturası / tahsilat / ödeme' }),
      col('date', 'Tarih (valör)', '20.03.2026', { required: true, aliases: ['tarih', 'valor', 'islem tarihi'] }),
      col('amount', 'Tutar', '10.000,00', { required: true, aliases: ['tutar', 'meblag'], hint: 'faturada KDV hariç matrah; tahsilat/ödemede ödenen tutar' }),
      col('currency', 'Para birimi', 'EUR', { required: true, aliases: ['doviz', 'pb'] }),
      col('rate', 'Kur (1 EUR = ? TL)', '37,20', { aliases: ['kur', 'eur tl kuru', 'eurtry'], hint: 'hareketin gerçek kuru (banka dekontu / fatura); yoksa TL veya EUR karşılığı' }),
      col('try_amount', 'TL karşılığı', '372.000,00', { aliases: ['tl karsiligi', 'tl tutar'] }),
      col('eur_amount', 'EUR karşılığı', '', { aliases: ['eur karsiligi', 'euro karsiligi'], hint: 'TL / USD hareketin kapattığı EUR tutarı (kur türetilir)' }),
      col('supplier', 'Tedarikçi', 'Moda Sahil Otel', { aliases: ['tedarikci adi'], hint: 'tedarikçi faturası / ödeme için' }),
      col('doc_no', 'Belge no', 'GIB2026000001234', { aliases: ['fatura no', 'dekont no', 'belge'] }),
      col('settles_doc_no', 'Kapattığı fatura no', '', { aliases: ['fatura', 'ilgili fatura'], hint: 'tahsilat / ödeme hangi faturayı kapattı (boşsa tarih sırasıyla)' }),
    ],
  },
};

export type ImportMovementType = 'customer_invoice' | 'supplier_invoice' | 'collection' | 'payment';
export function importMovementType(v: ImportCell): ImportMovementType | null {
  const k = slugTr(cellText(v));
  if (!k) return null;
  if (/^(MUSTERIFATURASI|SATISFATURASI|SATIS|CUSTOMERINVOICE)$/.test(k)) return 'customer_invoice';
  if (/^(TEDARIKCIFATURASI|ALISFATURASI|ALIS|SUPPLIERINVOICE)$/.test(k)) return 'supplier_invoice';
  if (/^(TAHSILAT|GELEN|GELENODEME|COLLECTION)$/.test(k)) return 'collection';
  if (/^(ODEME|GIDEN|GIDENODEME|TEDARIKCIODEMESI|PAYMENT)$/.test(k)) return 'payment';
  return null;
}

// ------------------------------------------------------------------ headers & CSV
export function headerKey(entity: ImportEntity, header: string): string | null {
  const h = slugTr(header ?? '');
  if (!h) return null;
  for (const c of IMPORT_TEMPLATES[entity].columns) {
    if ([c.key, c.label, ...(c.aliases ?? [])].some((a) => slugTr(a) === h)) return c.key;
  }
  return null;
}

/** Maps a header row to column keys; reports missing required columns and unknown headers. */
export function matchHeaders(entity: ImportEntity, headers: ImportCell[]): { keys: (string | null)[]; missing: string[]; unknown: string[] } {
  const keys: (string | null)[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const h of headers) {
    const k = h == null ? null : headerKey(entity, String(h));
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    } else {
      keys.push(null);
      if (h != null && String(h).trim()) unknown.push(String(h));
    }
  }
  const missing = IMPORT_TEMPLATES[entity].columns.filter((c) => c.required && !seen.has(c.key)).map((c) => c.label);
  return { keys, missing, unknown };
}

/** RFC4180-ish CSV parser: BOM, `;` / `,` / tab auto-detected from the first line, quoted fields incl. newlines. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((d) => [d, first.split(d).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// ------------------------------------------------------------------ value normalizers
const LEGAL_TOKENS = new Set(['AS', 'ANONIM', 'SIRKETI', 'SIRKET', 'LTD', 'LIMITED', 'STI', 'SAN', 'TIC', 'VE', 'INC', 'LLC', 'GMBH', 'CO']);

/** Name key for matching: Turkish-folded, punctuation and legal-form tokens (A.Ş., Ltd. Şti., San. Tic.) removed. */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  const folded = String(s).replace(/A\.\s?Ş\./gi, ' AS ').replace(/Ltd\.?\s?Şti\.?/gi, ' LTD STI ');
  return folded.split(/[^0-9A-Za-zçÇğĞıİöÖşŞüÜâÂîÎûÛ]+/).map((w) => slugTr(w)).filter((w) => w && !LEGAL_TOKENS.has(w)).join('');
}

/** VKN (10) / TCKN (11) digits, or null when empty; `invalid` when present but malformed. */
export function normalizeVkn(v: ImportCell): { value: string | null; invalid: boolean } {
  if (v == null || String(v).trim() === '') return { value: null, invalid: false };
  const d = String(typeof v === 'number' ? Math.round(v) : v).replace(/[\s.-]/g, '');
  return /^\d{10,11}$/.test(d) ? { value: d, invalid: false } : { value: null, invalid: true };
}

export function cellText(v: ImportCell): string {
  return v == null ? '' : String(v).trim();
}

/** Excel serial (1900 system) or TR / ISO text → YYYY-MM-DD. */
export function importDate(v: ImportCell): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
    return null;
  }
  return parseTrDate(String(v));
}

export function importNumber(v: ImportCell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  return parseTrNumber(String(v));
}

const KIND_WORDS: [RegExp, ServiceKind][] = [
  [/^(KONAKLAMA|ODA|OTEL|HOTEL|ACCOMMODATION|ACC)$/, 'accommodation'],
  [/^(SALON|TOPLANTISALONU|HALL|MEETINGROOM)$/, 'hall'],
  [/^(YIYECEKICECEK|YIYECEK|ICECEK|YEMEK|FNB|FB|COFFEEBREAK|IKRAM)$/, 'fnb'],
  [/^(TRANSFER|ULASIM|ARAC)$/, 'transfer'],
  [/^(TEKNIK|AV|TECHNICAL|SESISIK)$/, 'technical'],
  [/^(AKTIVITE|ETKINLIK|TUR|ACTIVITY)$/, 'activity'],
  [/^(BILET|TICKET)$/, 'ticket'],
  [/^(DIGER|OTHER)$/, 'other'],
];
export function importKind(v: ImportCell): ServiceKind | null {
  const k = slugTr(cellText(v));
  if (!k) return null;
  if ((SERVICE_KINDS as readonly string[]).includes(cellText(v).toLowerCase())) return cellText(v).toLowerCase() as ServiceKind;
  return KIND_WORDS.find(([re]) => re.test(k))?.[1] ?? null;
}
export function importKinds(v: ImportCell): { kinds: ServiceKind[]; unknown: string[] } {
  const parts = cellText(v).split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
  const kinds: ServiceKind[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const k = importKind(p);
    if (k) { if (!kinds.includes(k)) kinds.push(k); } else unknown.push(p);
  }
  return { kinds, unknown };
}

const UNIT_WORDS: [RegExp, string][] = [
  [/^(ODAGECE|ODAGECELIK|GECE|ROOMNIGHT)$/, 'room_night'],
  [/^(KISIGUN|PAXDAY|KISIBASIGUN)$/, 'pax_day'],
  [/^(GUN|DAY|GUNLUK)$/, 'day'],
  [/^(KISI|PAX|PERSON|KISIBASI)$/, 'pax'],
  [/^(ARAC|VEHICLE|SEFER)$/, 'vehicle'],
  [/^(GOTURU|TOPLAM|LUMPSUM|PAKET)$/, 'lump_sum'],
  [/^(ADET|PIECE)$/, 'piece'],
];
export function importUnit(v: ImportCell): { unit: string | null; known: boolean } {
  const raw = cellText(v);
  if (!raw) return { unit: null, known: false };
  const k = slugTr(raw);
  const hit = UNIT_WORDS.find(([re]) => re.test(k));
  if (hit) return { unit: hit[1], known: true };
  if (['room_night', 'pax_day', 'day', 'pax', 'vehicle', 'lump_sum', 'piece'].includes(raw)) return { unit: raw, known: true };
  return { unit: raw.toLowerCase(), known: false };
}

export function importBoard(v: ImportCell): string | null {
  const raw = cellText(v);
  if (!raw) return null;
  const k = slugTr(raw);
  if (/^(BB|ODAKAHVALTI|KAHVALTI)$/.test(k)) return 'BB';
  if (/^(HB|YARIMPANSIYON)$/.test(k)) return 'HB';
  if (/^(FB|TAMPANSIYON)$/.test(k)) return 'FB';
  if (/^(RO|SADECEODA)$/.test(k)) return 'RO';
  if (/^(AI|HERSEYDAHIL)$/.test(k)) return 'AI';
  return raw.toUpperCase();
}

export function importCancellation(v: ImportCell): 'flexible' | 'non_refundable' | null {
  const k = slugTr(cellText(v));
  if (!k) return null;
  if (/IADESIZ|NONREFUNDABLE|IADEEDILMEZ|IPTALEDILEMEZ/.test(k)) return 'non_refundable';
  if (/ESNEK|FLEXIBLE|IADELI|UCRETSIZIPTAL|IPTALEDILEBILIR/.test(k)) return 'flexible';
  return null;
}

export function importOutcome(v: ImportCell): 'won' | 'lost' | null {
  const k = slugTr(cellText(v));
  if (!k) return null;
  if (/^(KAZANILDI|KAZANDIK|WON|GERCEKLESTI|TAMAMLANDI|KAPANDI|CLOSED|ONAYLANDI)$/.test(k)) return 'won';
  if (/^(KAYBEDILDI|KAYBETTIK|LOST|KAYIP|IPTAL)$/.test(k)) return 'lost';
  return null;
}

export function importSupplierStatus(v: ImportCell): 'candidate' | 'accredited' | 'passive' | null {
  const k = slugTr(cellText(v));
  if (!k) return null;
  if (/^(ADAY|CANDIDATE|YENI)$/.test(k)) return 'candidate';
  if (/^(AKREDITE|ACCREDITED|ONAYLI)$/.test(k)) return 'accredited';
  if (/^(PASIF|PASSIVE)$/.test(k)) return 'passive';
  return null;
}

const truthy = (v: unknown) => v === true || /^(1|true|evet|e|yes|x)$/i.test(String(v ?? '').trim());

/** ISO date `months` months before `today` (same day of month, clamped). */
export function importWindowStart(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) - Math.max(0, Math.round(months));
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Short customer code from a name (fallback when the file has none). */
export function shortCodeFromName(name: string): string {
  const words = name.split(/\s+/).map((w) => slugTr(w)).filter((w) => w && !LEGAL_TOKENS.has(w));
  return (words.slice(0, 2).join('') || 'MUSTERI').slice(0, 12);
}

// ------------------------------------------------------------------ row normalization + row-level validation
export interface ImportOptions {
  /** YYYY-MM-DD (agency-local today) */
  today: string;
  /** rule `initialImportWindowMonths` */
  windowMonths: number;
}

export interface NormalizedImportRow { data: Record<string, unknown>; issues: ImportIssue[] }

export function rowStatus(issues: ImportIssue[]): ImportRowStatus {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.some((i) => i.severity === 'warning')) return 'warning';
  return 'ok';
}

export function normalizeImportRow(entity: ImportEntity, input: Record<string, ImportCell>, opts: ImportOptions): NormalizedImportRow {
  const issues: ImportIssue[] = [];
  const data: Record<string, unknown> = {};
  const err = (code: string, message: string, field?: string) => issues.push({ code, severity: 'error', message, field });
  const warn = (code: string, message: string, field?: string) => issues.push({ code, severity: 'warning', message, field });
  const info = (code: string, message: string, field?: string) => issues.push({ code, severity: 'info', message, field });
  const tpl = IMPORT_TEMPLATES[entity];
  for (const c of tpl.columns) if (c.required && cellText(input[c.key] ?? null) === '') err('REQUIRED', `${c.label} zorunlu`, c.key);
  const text = (k: string) => { const s = cellText(input[k] ?? null); return s || null; };
  const date = (k: string, label: string) => {
    const raw = input[k] ?? null;
    if (cellText(raw) === '') return null;
    const d = importDate(raw);
    if (!d) err('INVALID_DATE', `${label}: tarih okunamadı (gg.aa.yyyy)`, k);
    return d;
  };
  const num = (k: string, label: string, o: { int?: boolean; min?: number } = {}) => {
    const raw = input[k] ?? null;
    if (cellText(raw) === '') return null;
    const n = importNumber(raw);
    if (n == null || !Number.isFinite(n)) { err('INVALID_NUMBER', `${label}: sayı okunamadı`, k); return null; }
    if (o.min != null && n < o.min) { err('NEGATIVE', `${label} ${o.min} veya üstü olmalı`, k); return null; }
    return o.int ? Math.round(n) : n;
  };
  const currency = () => {
    const c = cellText(input.currency ?? null).toUpperCase().replace('TL', 'TRY').replace('₺', 'TRY').replace('€', 'EUR');
    if (!c) return null;
    if (!(CURRENCIES as readonly string[]).includes(c)) { err('UNKNOWN_CURRENCY', `Bilinmeyen para birimi: ${c}`, 'currency'); return null; }
    return c;
  };
  const windowStart = importWindowStart(opts.today, opts.windowMonths);
  const inWindow = (d: string | null, field: string, label: string, futureIsError = true) => {
    if (!d) return;
    if (d > opts.today) {
      if (futureIsError) err('NOT_CLOSED', `${label} ${d} gelecekte — yalnız kapanmış iş aktarılır`, field);
      else warn('FUTURE_DATE', `${label} ${d} gelecekte`, field);
    } else if (d < windowStart) {
      err('OUT_OF_WINDOW', `${label} ${d} aktarım penceresinin dışında (son ${opts.windowMonths} ay: ${windowStart} sonrası; kural initialImportWindowMonths)`, field);
    }
  };
  const vkn = (k: string) => {
    const v = normalizeVkn(input[k] ?? null);
    if (v.invalid) err('INVALID_VKN', 'VKN 10 haneli (TCKN 11 haneli) olmalı', k);
    return v.value;
  };

  switch (entity) {
    case 'suppliers': {
      data.name = text('name');
      data.vkn = vkn('vkn');
      data.city = text('city');
      data.district = text('district');
      const k = importKinds(input.kinds ?? null);
      data.kinds = k.kinds;
      if (k.unknown.length) err('UNKNOWN_KIND', `Bilinmeyen hizmet türü: ${k.unknown.join(', ')}`, 'kinds');
      else if (!k.kinds.length && text('kinds')) err('UNKNOWN_KIND', 'Hizmet türü okunamadı', 'kinds');
      const st = text('status') ? importSupplierStatus(input.status ?? null) : 'candidate';
      if (!st) err('UNKNOWN_STATUS', 'Statü aday / akredite / pasif olmalı', 'status');
      data.status = st === 'passive' ? 'passive' : 'candidate';
      data.accredit = truthy(input.accredit) && st !== 'passive';
      if (data.accredit) info('ACCREDIT_BY_ADMIN', 'Yönetici akreditasyonu: aktarımda karar kutusu üzerinden yöneticinin onayıyla verilir', 'accredit');
      else if (st === 'accredited') warn('ACCREDITATION_REVIEW', "Dosyada 'akredite' yazıyor; aday olarak aktarılır. Akredite etmek için satırda 'Akredite et'i işaretleyin (yalnız yönetici)", 'status');
      data.segment = text('segment');
      data.email = text('email');
      if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email))) warn('INVALID_EMAIL', 'E-posta biçimi şüpheli', 'email');
      data.phone = text('phone');
      data.contactName = text('contact_name');
      data.capacityPax = num('capacity_pax', 'Kapasite', { int: true, min: 0 });
      data.roomCount = num('room_count', 'Oda sayısı', { int: true, min: 0 });
      data.paymentTerms = text('payment_terms');
      break;
    }
    case 'customers': {
      data.name = text('name');
      data.vkn = vkn('vkn');
      const sc = text('short_code');
      data.shortCode = sc ? slugTr(sc).slice(0, 20) || null : data.name ? shortCodeFromName(String(data.name)) : null;
      if (!sc && data.name) info('SHORT_CODE_DERIVED', `Kısa kod addan üretildi: ${data.shortCode}`, 'short_code');
      data.taxOffice = text('tax_office');
      data.billingAddress = text('billing_address');
      data.contactName = text('contact_name');
      data.contactEmail = text('contact_email');
      data.contactPhone = text('contact_phone');
      break;
    }
    case 'projects': {
      data.code = text('code');
      data.title = text('title');
      data.customer = text('customer');
      data.customerVkn = vkn('customer_vkn');
      data.eventType = text('event_type');
      data.startDate = date('start_date', 'Başlangıç');
      data.endDate = date('end_date', 'Bitiş');
      data.closedDate = date('closed_date', 'Kapanış tarihi');
      if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) err('DATE_ORDER', 'Bitiş başlangıçtan önce olamaz', 'end_date');
      const ref = (data.closedDate ?? data.endDate ?? data.startDate) as string | null;
      inWindow(ref, data.closedDate ? 'closed_date' : data.endDate ? 'end_date' : 'start_date', 'Kapanış');
      data.pax = num('pax', 'Kişi', { int: true, min: 1 });
      data.city = text('city');
      data.district = text('district');
      data.venue = text('venue');
      const o = text('outcome') ? importOutcome(input.outcome ?? null) : null;
      if (text('outcome') && !o) err('UNKNOWN_OUTCOME', 'Sonuç kazanıldı / kaybedildi olmalı', 'outcome');
      data.outcome = o;
      data.lostReason = text('lost_reason');
      if (o === 'lost' && !data.lostReason) err('LOST_REASON_REQUIRED', 'Kaybedilen proje için kayıp nedeni zorunlu', 'lost_reason');
      if (o === 'won' && data.lostReason) { warn('LOST_REASON_IGNORED', 'Kazanılan projede kayıp nedeni yok sayılır', 'lost_reason'); data.lostReason = null; }
      data.notes = text('notes');
      break;
    }
    case 'service_lines': {
      data.projectCode = text('project_code');
      data.kind = text('kind') ? importKind(input.kind ?? null) : null;
      if (text('kind') && !data.kind) err('UNKNOWN_KIND', `Bilinmeyen tür: ${text('kind')}`, 'kind');
      data.description = text('description');
      data.supplier = text('supplier');
      data.supplierVkn = vkn('supplier_vkn');
      data.dateFrom = date('date_from', 'Tarih');
      data.dateTo = date('date_to', 'Bitiş');
      if (data.dateFrom && data.dateTo && String(data.dateTo) < String(data.dateFrom)) err('DATE_ORDER', 'Bitiş başlangıçtan önce olamaz', 'date_to');
      data.quantity = num('quantity', 'Miktar', { min: 0 });
      if (data.quantity === 0) err('ZERO_QUANTITY', 'Miktar 0 olamaz', 'quantity');
      const u = importUnit(input.unit ?? null);
      data.unit = u.unit;
      if (u.unit && !u.known) warn('UNKNOWN_UNIT', `Birim tanınmadı (${u.unit}); fiyat karşılaştırmasında eşleşmeyebilir`, 'unit');
      data.nights = num('nights', 'Gece', { int: true, min: 0 });
      data.currency = currency();
      data.unitCost = num('unit_cost', 'Birim alış', { min: 0 });
      data.unitSale = num('unit_sale', 'Birim satış', { min: 0 });
      data.roomType = text('room_type')?.toUpperCase() ?? null;
      data.board = importBoard(input.board ?? null);
      const cost = data.unitCost as number | null;
      const sale = data.unitSale as number | null;
      data.valueAdd = cost === 0;
      if (cost != null && sale != null) {
        if (cost > sale) warn('COST_ABOVE_SALE', `Alış (${cost}) satıştan (${sale}) yüksek — zarar; kontrol edin`, 'unit_cost');
        else if (cost === 0 && sale === 0) warn('ZERO_PRICES', 'Alış ve satış 0', 'unit_cost');
        else if (cost === 0) info('VALUE_ADD', 'Alış 0 — katma değer (ikram) kalemi; fiyat geçmişine yazılmaz', 'unit_cost');
        else if (sale > cost * 3) warn('MARKUP_SUSPICIOUS', 'Satış alışın 3 katından fazla — kontrol edin', 'unit_sale');
      }
      if (data.kind === 'accommodation' && !data.roomType) warn('ROOM_TYPE_MISSING', 'Konaklamada oda tipi yok; kanal karşılaştırmasına girmez', 'room_type');
      if (!data.supplier && !data.supplierVkn) warn('SUPPLIER_MISSING', 'Tedarikçi yok — fiyat geçmişine ve skora yazılmaz', 'supplier');
      break;
    }
    case 'price_points': {
      data.supplier = text('supplier');
      data.supplierVkn = vkn('supplier_vkn');
      data.date = date('date', 'Hizmet tarihi');
      inWindow(data.date as string | null, 'date', 'Hizmet tarihi');
      data.kind = text('kind') ? importKind(input.kind ?? null) : null;
      if (text('kind') && !data.kind) err('UNKNOWN_KIND', `Bilinmeyen tür: ${text('kind')}`, 'kind');
      data.description = text('description');
      const u = importUnit(input.unit ?? null);
      data.unit = u.unit;
      if (u.unit && !u.known) warn('UNKNOWN_UNIT', `Birim tanınmadı (${u.unit})`, 'unit');
      data.price = num('price', 'Fiyat', { min: 0 });
      if (data.price === 0) err('ZERO_PRICE', 'Fiyat 0 olamaz', 'price');
      data.currency = currency();
      data.roomType = text('room_type')?.toUpperCase() ?? null;
      data.board = importBoard(input.board ?? null);
      data.cancellation = text('cancellation') ? importCancellation(input.cancellation ?? null) : null;
      if (text('cancellation') && !data.cancellation) err('UNKNOWN_CANCELLATION', 'İptal koşulu esnek / iadesiz olmalı', 'cancellation');
      data.pax = num('pax', 'Kişi', { int: true, min: 1 });
      if (data.kind === 'accommodation' && !data.roomType) warn('ROOM_TYPE_MISSING', 'Konaklamada oda tipi yok; kanal karşılaştırmasına girmez', 'room_type');
      break;
    }
    case 'channel_prices': {
      data.supplier = text('supplier');
      data.supplierVkn = vkn('supplier_vkn');
      data.stayDate = date('stay_date', 'Konaklama tarihi');
      inWindow(data.stayDate as string | null, 'stay_date', 'Konaklama tarihi', false);
      data.roomType = text('room_type')?.toUpperCase() ?? null;
      data.board = importBoard(input.board ?? null);
      data.cancellation = text('cancellation') ? importCancellation(input.cancellation ?? null) : null;
      if (text('cancellation') && !data.cancellation) err('UNKNOWN_CANCELLATION', 'İptal koşulu esnek / iadesiz olmalı', 'cancellation');
      data.price = num('price', 'Fiyat', { min: 0 });
      if (data.price === 0) err('ZERO_PRICE', 'Fiyat 0 olamaz', 'price');
      data.currency = currency();
      data.source = text('source') ?? 'Geçmiş aktarım';
      data.capturedAt = date('captured_at', 'Kayıt tarihi');
      break;
    }
    case 'finance_movements': {
      data.projectCode = text('project_code');
      data.type = text('type') ? importMovementType(input.type ?? null) : null;
      if (text('type') && !data.type) err('UNKNOWN_MOVEMENT_TYPE', 'Hareket türü müşteri faturası / tedarikçi faturası / tahsilat / ödeme olmalı', 'type');
      data.date = date('date', 'Tarih');
      if (data.date && String(data.date) > opts.today) err('FUTURE_DATE', `Tarih ${data.date} gelecekte — yalnız gerçekleşmiş hareket aktarılır`, 'date');
      data.amount = num('amount', 'Tutar', { min: 0 });
      if (data.amount === 0) err('ZERO_AMOUNT', 'Tutar 0 olamaz', 'amount');
      data.currency = currency();
      const rate = num('rate', 'Kur', { min: 0 });
      const tryAmount = num('try_amount', 'TL karşılığı', { min: 0 });
      const eurAmount = num('eur_amount', 'EUR karşılığı', { min: 0 });
      data.supplier = text('supplier');
      data.docNo = text('doc_no');
      data.settlesDocNo = text('settles_doc_no');
      if (data.amount && data.currency) {
        const r = deriveMovementRates({ amount: data.amount as number, currency: data.currency as string, eurTryRate: rate, tryAmount, eurAmount });
        data.eurRate = data.currency === 'EUR' ? 1 : r.eurRate;
        data.eurTryRate = r.eurTryRate;
        const needTry = data.currency !== 'TRY' && r.eurTryRate == null;
        const needEur = data.currency !== 'EUR' && r.eurRate == null;
        if (needTry || needEur) {
          warn('FX_EVIDENCE_MISSING', `Kur kanıtı yok — ${needEur ? 'EUR' : 'TL'} karşılığı tahmin edilmez; TCMB valör günü kuru varsa o kullanılır, yoksa kâr kısmi`, 'rate');
        }
        if (rate != null && tryAmount != null && data.currency === 'EUR' && Math.abs(rate * (data.amount as number) - tryAmount) > Math.max(1, tryAmount * 0.005)) {
          warn('RATE_TRY_MISMATCH', `Kur × tutar (${Math.round(rate * (data.amount as number) * 100) / 100}) TL karşılığıyla uyuşmuyor — kur esas alındı`, 'try_amount');
        }
      }
      if (data.settlesDocNo && (data.type === 'customer_invoice' || data.type === 'supplier_invoice')) {
        warn('SETTLES_IGNORED', 'Faturada "kapattığı fatura" yok sayılır', 'settles_doc_no');
        data.settlesDocNo = null;
      }
      break;
    }
  }
  return { data, issues };
}

/** Key for duplicate detection inside one file. */
export function importNaturalKey(entity: ImportEntity, d: Record<string, unknown>): string {
  const n = (v: unknown) => (v == null ? '' : String(v));
  switch (entity) {
    case 'suppliers': return d.vkn ? `vkn:${d.vkn}` : `name:${normalizeName(n(d.name))}:${normalizeName(n(d.city))}`;
    case 'customers': return d.vkn ? `vkn:${d.vkn}` : `name:${normalizeName(n(d.name))}`;
    case 'projects': return `code:${slugTr(n(d.code))}`;
    case 'service_lines': return [slugTr(n(d.projectCode)), d.kind, normalizeName(n(d.description)), normalizeName(n(d.supplier)), d.dateFrom, d.quantity, d.unitCost, d.roomType].map(n).join('|');
    case 'price_points': return [normalizeName(n(d.supplier)), d.supplierVkn, d.date, d.kind, d.unit, d.price, d.currency, d.roomType, d.board].map(n).join('|');
    case 'channel_prices': return [normalizeName(n(d.supplier)), d.supplierVkn, d.stayDate, d.roomType, d.board, d.cancellation, d.price, d.currency].map(n).join('|');
    case 'finance_movements': return [slugTr(n(d.projectCode)), d.type, d.date, d.amount, d.currency, n(d.docNo).toUpperCase()].map(n).join('|');
  }
}

/** Historical project code stored in projects.code (never collides with the live PRJ-#### sequence). */
export function historicalProjectCode(sourceCode: string): string {
  return `H-${sourceCode.trim().replace(/\s+/g, '-')}`.slice(0, 80);
}
