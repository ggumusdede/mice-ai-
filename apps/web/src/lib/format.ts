// Display formatters. Money always via Intl.NumberFormat('tr-TR'); markup and margin always separate.
const LOCALE = 'tr-TR';

const moneyCache = new Map<string, Intl.NumberFormat>();
function moneyFmt(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  let f = moneyCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyCache.set(key, f);
  }
  return f;
}

/** 1234.5, 'EUR' → "€1.234,50". null/undefined/NaN → "—". */
export function money(value: number | null | undefined, currency = 'EUR', digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const d = digits ?? (Math.abs(value) >= 10000 ? 0 : 2);
  return moneyFmt(currency, d).format(value);
}

/** v0.5 S-19: amounts are in the PROJECT's base currency (the agency's choice: TL / EUR / USD). The project page (and agency-level
 *  reports) set the display currency; the legacy name `eur` is kept so every screen follows it. */
let displayBase = 'EUR';
export function setDisplayBase(currency: string | null | undefined): void {
  displayBase = currency || 'EUR';
}
export function displayBaseCurrency(): string {
  return displayBase;
}
export const eur = (v: number | null | undefined, digits?: number) => money(v, displayBase, digits);
export const tl = (v: number | null | undefined, digits = 0) => money(v, 'TRY', digits);

const numFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numFmt.format(value);
}

/** fraction → "%12,5". */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALE, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

/** Signed percent for advantages: +%18 / −%3 */
export function signedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const s = pct(Math.abs(value), digits);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function date(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!value) return '—';
  const d = parseDate(value);
  if (!d) return value;
  return new Intl.DateTimeFormat(LOCALE, opts).format(d);
}

export function dateTime(value: string | null | undefined): string {
  return date(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "12–14 Mar 2026" style range. */
export function dateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return '—';
  if (!to || from === to) return date(from);
  if (!from) return date(to);
  const a = parseDate(from);
  const b = parseDate(to);
  if (a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${date(to)}`;
  }
  return `${date(from, { day: 'numeric', month: 'short' })} – ${date(to)}`;
}

/** Date-only strings (YYYY-MM-DD) are parsed as local dates to avoid TZ shifting. */
export function parseDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3 dk önce", "2 sa önce", "dün", or a date. */
export function relative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const d = parseDate(value);
  if (!d) return value;
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600) return `${Math.max(1, Math.round(ahead / 60))} dk sonra`;
    if (ahead < 86400) return `${Math.round(ahead / 3600)} sa sonra`;
    return `${Math.round(ahead / 86400)} gün sonra`;
  }
  if (diff < 60) return 'şimdi';
  if (diff < 3600) return `${Math.round(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.round(diff / 3600)} sa önce`;
  if (diff < 172800) return 'dün';
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} gün önce`;
  return date(value);
}

/** Business minutes → "1 g 3 sa" assuming 9h business day. */
export function businessDuration(minutes: number | null | undefined, hoursPerDay = 9): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const h = Math.floor(minutes / 60);
  const days = Math.floor(h / hoursPerDay);
  const rest = h % hoursPerDay;
  const mins = Math.round(minutes % 60);
  if (days > 0) return rest ? `${days} iş günü ${rest} sa` : `${days} iş günü`;
  if (h > 0) return mins ? `${h} sa ${mins} dk` : `${h} sa`;
  return `${mins} dk`;
}

/** Profit split — margin (Kâr÷Satış) and markup (Kâr÷Alış) are always separate (§9). */
export function profitOf(costEur: number, saleEur: number) {
  const profit = saleEur - costEur;
  return {
    costEur,
    saleEur,
    profitEur: profit,
    margin: saleEur !== 0 ? profit / saleEur : 0,
    markup: costEur !== 0 ? profit / costEur : 0,
  };
}

export function marginFromMarkup(markup: number): number {
  return markup <= -1 ? 0 : markup / (1 + markup);
}

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the week containing `now` as YYYY-MM-DD. */
export function weekStartISO(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return todayISO(d);
}

export function confidenceLevel(c: number | null | undefined, threshold = 0.8): 'high' | 'low' | 'none' {
  if (c === null || c === undefined) return 'none';
  return c < threshold ? 'low' : 'high';
}

/** Humanize a camelCase / snake_case key for generic detail rendering. */
export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

const STALE_SOURCE: Record<string, string> = {
  quote: 'Müşteri teklifi', project: 'Proje', service_item: 'Hizmet kalemi', supplier_offer: 'Tedarikçi teklifi',
  contract: 'Sözleşme', finance_entry: 'Finans kaydı', guest: 'Misafir listesi', field_extra: 'Saha ekstrası', customer: 'Müşteri',
};
const STALE_FIELD: Record<string, string> = {
  accepted_option_no: 'kabul edilen seçenek', status: 'durum', pax: 'kişi sayısı', start_date: 'başlangıç', end_date: 'bitiş',
  rooms_sgl: 'SGL oda', rooms_dbl: 'DBL oda', hall_layout: 'salon düzeni', fnb_needs: 'yiyecek-içecek', quantity: 'miktar',
  nights: 'gece', lines: 'satırlar', options: 'seçenekler', currency: 'para birimi', billing_info: 'fatura bilgisi',
};
/** DB staleness reasons look like `quote değişti: accepted_option_no, status` (format used by the propagation trigger). */
export function staleReason(reason: string | null | undefined): string {
  if (!reason) return '';
  const m = /^(\w+) değişti: (.*)$/.exec(reason.trim());
  if (!m) return reason;
  const fields = m[2].split(/,\s*/).filter(Boolean).map((f) => STALE_FIELD[f] ?? f.replace(/_/g, ' '));
  return `${STALE_SOURCE[m[1]] ?? m[1].replace(/_/g, ' ')} değişti${fields.length ? ` (${fields.join(', ')})` : ''}`;
}
