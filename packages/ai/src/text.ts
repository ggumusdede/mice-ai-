// Low-level, dependency-free text helpers shared by the mock (heuristic) service and by the
// Claude service's post-validation. Turkish-first, with English and basic Russian support.
import { CURRENCIES, type Currency, type Language } from '@mice/shared';

/** Turkish-aware lowercase + diacritic folding (ç→c, ğ→g, ı/İ→i, ö→o, ş→s, ü→u, â/î/û→a/i/u). Length-preserving. */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const map: Record<string, string> = {
      'İ': 'i', 'I': 'ı', 'Ç': 'ç', 'Ğ': 'ğ', 'Ö': 'ö', 'Ş': 'ş', 'Ü': 'ü', 'Â': 'â', 'Î': 'î', 'Û': 'û',
    };
    const lower = (map[ch] ?? ch).toLowerCase();
    const f: Record<string, string> = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
    const r = f[lower] ?? lower;
    // keep 1:1 length so indexes in folded text map back to the original
    out += r.length === ch.length ? r : ch.length === 1 ? r.slice(0, 1) : r;
  }
  return out;
}

export function clamp01(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parses a money/number token written in TR or EN conventions:
 * "1.500" → 1500, "1.500,50" → 1500.5, "1,500.50" → 1500.5, "12,5" → 12.5, "120" → 120.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0']/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  let norm: string;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal separator
    if (lastComma > lastDot) norm = s.replace(/\./g, '').replace(',', '.');
    else norm = s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    norm = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  } else if (lastComma >= 0) {
    norm = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else norm = s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- currency
const CURRENCY_TOKENS: [RegExp, Currency][] = [
  [/^(eur|euro|avro|€|евро)$/i, 'EUR'],
  [/^(tl|try|₺|türk lirası|turk lirasi|lira|руб)$/i, 'TRY'],
  [/^(usd|\$|dolar|dollar|доллар)$/i, 'USD'],
  [/^(gbp|£|sterlin|pound)$/i, 'GBP'],
];
export const CURRENCY_RE_SRC = '(?:EUR|EURO|Euro|euro|Avro|avro|€|TL|TRY|₺|USD|\\$|dolar|Dolar|GBP|£|sterlin)';

export function toCurrency(token: string | null | undefined): Currency | null {
  if (!token) return null;
  const t = token.trim();
  for (const [re, c] of CURRENCY_TOKENS) if (re.test(t)) return c;
  const up = t.toUpperCase();
  return (CURRENCIES as readonly string[]).includes(up) ? (up as Currency) : null;
}

const NUM_SRC = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
/** Finds money amounts: "120 EUR", "€120", "1.500,00 TL", "EUR 1,500". */
export function findMoney(line: string): { amount: number; currency: Currency; index: number; length: number }[] {
  const out: { amount: number; currency: Currency; index: number; length: number }[] = [];
  const after = new RegExp(`(${NUM_SRC})\\s*(${CURRENCY_RE_SRC})(?![A-Za-zğüşıöç])`, 'g');
  const before = new RegExp(`(${CURRENCY_RE_SRC})\\s*(${NUM_SRC})`, 'g');
  for (const m of line.matchAll(after)) {
    const amount = parseNumber(m[1]);
    const currency = toCurrency(m[2]);
    if (amount !== null && currency) out.push({ amount, currency, index: m.index ?? 0, length: m[0].length });
  }
  for (const m of line.matchAll(before)) {
    const idx = m.index ?? 0;
    if (out.some((o) => idx >= o.index && idx < o.index + o.length)) continue;
    if (out.some((o) => o.index >= idx && o.index < idx + m[0].length)) continue;
    const amount = parseNumber(m[2]);
    const currency = toCurrency(m[1]);
    if (amount !== null && currency) out.push({ amount, currency, index: idx, length: m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------- dates
const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
  'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6, 'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
};
/** month-name alternation for regexes, matched against folded text; longest first */
const MONTH_SRC = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

export function monthNumber(name: string): number | null {
  const f = fold(name).replace(/[^a-zа-яё]/g, '');
  if (MONTHS[f]) return MONTHS[f];
  // allow Turkish suffixes: "Mart'ta", "martta", "Mayıs'ın"
  for (const k of Object.keys(MONTHS).sort((a, b) => b.length - a.length)) if (k.length >= 3 && f.startsWith(k)) return MONTHS[k];
  return null;
}

export function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return isoDate(y, m, d) === s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Infers the year for a day+month without a year: the first occurrence on/after `today`. */
function inferYear(m: number, d: number, today: string): number {
  const ty = Number(today.slice(0, 4)) || new Date().getUTCFullYear();
  const cand = isoDate(ty, m, d);
  return cand && cand >= today ? ty : ty + 1;
}

function normYear(y: string | undefined): number | null {
  if (!y) return null;
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

export interface DateMention {
  start: string;
  end: string | null;
  index: number;
  length: number;
  /** false when the year was inferred */
  explicitYear: boolean;
  raw: string;
}

/**
 * Finds date and date-range mentions. Supported forms (TR/EN/RU):
 * "12-14 Mart 2027", "12 Mart - 2 Nisan 2027", "12 Mart 2027", "12 Mart", "March 12-14, 2027", "March 12, 2027",
 * "12.03.2027", "12/03/2027", "12.03.2027 - 14.03.2027", "12-14.03.2027", "2027-03-12".
 */
export function findDates(text: string, today: string): DateMention[] {
  const f = fold(text);
  const found: DateMention[] = [];
  const taken = (i: number, len: number) => found.some((x) => i < x.index + x.length && x.index < i + len);
  const push = (m: RegExpMatchArray, start: string | null, end: string | null, explicitYear: boolean) => {
    const idx = m.index ?? 0;
    if (!start || taken(idx, m[0].length)) return;
    if (end && end < start) end = null;
    found.push({ start, end, index: idx, length: m[0].length, explicitYear, raw: text.slice(idx, idx + m[0].length) });
  };
  const sep = '\\s*(?:-|–|—|/|ile|ila|to|until|till|до|по)\\s*';
  const ySrc = "(?:[',]?\\s*(\\d{4}))?";
  const W = '(?![a-zа-я])';
  // Turkish case suffixes after a month name ("Mart'ta", "martta", "Mayısın"), never arbitrary letters ("Marmaris")
  const MSUF = "(?:['’][a-z]*|inda|unda|nin|nun|tan|ten|dan|den|ta|te|da|de|in|un|ya|ye|a|e)?(?![a-zа-я])";

  // ISO
  for (const m of f.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, isoDate(+m[1], +m[2], +m[3]), null, true);
  // dd.mm.yyyy - dd.mm.yyyy
  for (const m of f.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s*(?:-|–|—|ile|to)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/g)) {
    push(m, isoDate(normYear(m[3])!, +m[2], +m[1]), isoDate(normYear(m[6])!, +m[5], +m[4]), true);
  }
  // dd-dd.mm.yyyy
  for (const m of f.matchAll(/\b(\d{1,2})\s*(?:-|–)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/g)) {
    const y = normYear(m[4])!;
    push(m, isoDate(y, +m[3], +m[1]), isoDate(y, +m[3], +m[2]), true);
  }
  // dd.mm.yyyy
  for (const m of f.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2}(?![\d.]))/g)) push(m, isoDate(normYear(m[3])!, +m[2], +m[1]), null, true);
  // 12 Mart - 2 Nisan 2027
  for (const m of f.matchAll(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_SRC})${MSUF}${sep}(\\d{1,2})\\.?\\s+(${MONTH_SRC})${MSUF}${ySrc}`, 'g'))) {
    const m1 = MONTHS[m[2]], m2 = MONTHS[m[4]];
    const y2 = m[5] ? +m[5] : inferYear(m2, +m[3], today);
    const y1 = m1 > m2 ? y2 - 1 : y2;
    push(m, isoDate(y1, m1, +m[1]), isoDate(y2, m2, +m[3]), !!m[5]);
  }
  // 12-14 Mart 2027
  for (const m of f.matchAll(new RegExp(`\\b(\\d{1,2})${sep}(\\d{1,2})\\.?\\s+(${MONTH_SRC})${MSUF}${ySrc}`, 'g'))) {
    const mo = MONTHS[m[3]];
    const y = m[4] ? +m[4] : inferYear(mo, +m[1], today);
    push(m, isoDate(y, mo, +m[1]), isoDate(y, mo, +m[2]), !!m[4]);
  }
  // March 12-14, 2027
  for (const m of f.matchAll(new RegExp(`\\b(${MONTH_SRC})${W}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to)\\s*(\\d{1,2})(?:st|nd|rd|th)?${ySrc}`, 'g'))) {
    const mo = MONTHS[m[1]];
    const y = m[4] ? +m[4] : inferYear(mo, +m[2], today);
    push(m, isoDate(y, mo, +m[2]), isoDate(y, mo, +m[3]), !!m[4]);
  }
  // 12 Mart 2027 / 12th March
  for (const m of f.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?(${MONTH_SRC})${MSUF}${ySrc}`, 'g'))) {
    const mo = MONTHS[m[2]];
    const y = m[3] ? +m[3] : inferYear(mo, +m[1], today);
    push(m, isoDate(y, mo, +m[1]), null, !!m[3]);
  }
  // March 12, 2027
  for (const m of f.matchAll(new RegExp(`\\b(${MONTH_SRC})${W}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d.])${ySrc}`, 'g'))) {
    const mo = MONTHS[m[1]];
    const y = m[3] ? +m[3] : inferYear(mo, +m[2], today);
    push(m, isoDate(y, mo, +m[2]), null, !!m[3]);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** First date found in a string (ISO), or null. */
export function firstDate(text: string, today: string): string | null {
  return findDates(text, today)[0]?.start ?? null;
}

// ---------------------------------------------------------------- language
export function detectLanguage(text: string): Language {
  const cyr = (text.match(/[а-яё]/gi) ?? []).length;
  const lat = (text.match(/[a-zçğıöşü]/gi) ?? []).length;
  if (cyr > lat * 0.3 && cyr > 5) return 'ru';
  const trChars = (text.match(/[çğıöşüİ]/g) ?? []).length;
  const f = ` ${fold(text)} `;
  const trWords = (f.match(/\s(ve|icin|rica|kisi|kisilik|merhaba|tarih\w*|teklif\w*|toplanti\w*|bir|ile|olarak|gece|oda|salon|butce|saygilar\w*|tesekkur\w*)\s/g) ?? []).length;
  const enWords = (f.match(/\s(the|and|for|please|we|our|would|room|rooms|meeting|people|dear|regards|quote|thanks|with)\s/g) ?? []).length;
  if (trChars + trWords * 2 >= enWords * 2 && (trChars > 0 || trWords > 0)) return 'tr';
  return enWords > 0 ? 'en' : 'tr';
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n|(?<=[.;])\s+(?=[A-ZÇĞİÖŞÜ%])/).map((l) => l.trim()).filter(Boolean);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
