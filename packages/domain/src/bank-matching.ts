// §7 Adım 7 Banka hareketi ↔ fatura ↔ proje eşleştirmesi
import { slugTr } from './project-code.js';

export interface MatchCandidate { entryId: string; confidence: number; reasons: string[] }

const alnum = (s: string | null | undefined) => (s ? slugTr(s) : '');
const DAY = 86_400_000;

/** Scores open finance entries for a bank transaction by amount (exact/near), currency, reference/invoice no/name tokens in description, date proximity to due date.
 *  Sorted desc. Confidence >= threshold → auto-match allowed (autonomous); below → 'low_confidence_payment_match' suggestion.
 *  Weights: exact amount 0.5 (≤1% 0.3, ≤5% 0.1), same currency 0.1, invoice no in text 0.3, reference in text 0.25,
 *  counterparty name tokens up to 0.15, due date within 3 days 0.1 (10 days 0.05). Capped at 1. Direction must agree
 *  (positive amount = incoming 'in', negative = outgoing 'out'). Ties at the top are penalised ×0.8 (ambiguous). */
export function matchBankTransaction(tx: { amount: number; currency: string; description: string; counterparty: string | null; bookedAt: string }, entries: { id: string; amount: number; currency: string; reference: string | null; invoiceNo: string | null; counterpartyName: string | null; dueDate: string | null; direction: 'in' | 'out' }[]): MatchCandidate[] {
  if (!Number.isFinite(tx.amount) || tx.amount === 0) return [];
  const dir: 'in' | 'out' = tx.amount > 0 ? 'in' : 'out';
  const txAbs = Math.abs(tx.amount);
  const haystack = alnum(`${tx.description} ${tx.counterparty ?? ''}`);
  const booked = Date.parse(tx.bookedAt.slice(0, 10) + 'T00:00:00Z');

  const out: MatchCandidate[] = [];
  for (const e of entries) {
    if (e.direction !== dir) continue;
    let score = 0;
    const reasons: string[] = [];
    const sameCur = e.currency.toUpperCase() === tx.currency.toUpperCase();
    if (sameCur) {
      score += 0.1;
      reasons.push('Para birimi aynı');
      const eAbs = Math.abs(e.amount);
      const diff = Math.abs(eAbs - txAbs);
      if (diff <= 0.01) {
        score += 0.5;
        reasons.push('Tutar birebir');
      } else if (eAbs > 0 && diff / eAbs <= 0.01) {
        score += 0.3;
        reasons.push('Tutar %1 içinde');
      } else if (eAbs > 0 && diff / eAbs <= 0.05) {
        score += 0.1;
        reasons.push('Tutar %5 içinde');
      }
    } else {
      reasons.push('Para birimi farklı');
    }
    const inv = alnum(e.invoiceNo);
    if (inv.length >= 3 && haystack.includes(inv)) {
      score += 0.3;
      reasons.push(`Fatura no açıklamada (${e.invoiceNo})`);
    }
    const ref = alnum(e.reference);
    if (ref.length >= 3 && ref !== inv && haystack.includes(ref)) {
      score += 0.25;
      reasons.push(`Referans açıklamada (${e.reference})`);
    }
    if (e.counterpartyName) {
      const tokens = e.counterpartyName
        .split(/[\s.,;:/()-]+/)
        .map(alnum)
        .filter((t) => t.length >= 3 && !['LTD', 'STI', 'SAN', 'TIC', 'VE', 'AS', 'OTEL', 'HOTEL', 'TURIZM'].includes(t));
      if (tokens.length) {
        const hit = tokens.filter((t) => haystack.includes(t)).length;
        if (hit) {
          score += 0.15 * (hit / tokens.length);
          reasons.push(`Karşı taraf adı eşleşiyor (${hit}/${tokens.length})`);
        }
      }
    }
    if (e.dueDate && !Number.isNaN(booked)) {
      const due = Date.parse(e.dueDate.slice(0, 10) + 'T00:00:00Z');
      if (!Number.isNaN(due)) {
        const days = Math.abs(booked - due) / DAY;
        if (days <= 3) {
          score += 0.1;
          reasons.push('Vade tarihine yakın (≤3 gün)');
        } else if (days <= 10) {
          score += 0.05;
          reasons.push('Vade tarihine yakın (≤10 gün)');
        }
      }
    }
    const confidence = Math.round(Math.min(1, score) * 1000) / 1000;
    // a currency match alone is not evidence of anything
    if (confidence > 0.1 + 1e-9) out.push({ entryId: e.id, confidence, reasons });
  }
  out.sort((a, b) => b.confidence - a.confidence || a.entryId.localeCompare(b.entryId));
  if (out.length > 1 && out[0].confidence === out[1].confidence) {
    const top = out[0].confidence;
    for (const c of out) {
      if (c.confidence === top) {
        c.confidence = Math.round(c.confidence * 0.8 * 1000) / 1000;
        c.reasons.push('Birden fazla eşit aday — belirsiz');
      }
    }
  }
  return out;
}

/** Parses Turkish / international number formats: "1.234,56" → 1234.56, "1,234.56" → 1234.56, "1234,56", "1.234" (TR thousands) → 1234,
 *  "-1.234,56", "(1.234,56)", "1.234,56-", "1.234,56 TL", "€ 1,234.56". Returns NaN when unparsable. */
export function parseTrNumber(s: string): number {
  if (s == null) return NaN;
  let str = String(s).trim();
  if (!str) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/(TL|TRY|EUR|USD|GBP|₺|€|\$|£)/gi, '').replace(/[\s  ']/g, '');
  if (str.endsWith('-')) {
    negative = !negative;
    str = str.slice(0, -1);
  }
  if (str.startsWith('-')) {
    negative = !negative;
    str = str.slice(1);
  } else if (str.startsWith('+')) str = str.slice(1);
  if (!/^[\d.,]+$/.test(str) || !/\d/.test(str)) return NaN;

  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // both present: the last one is the decimal separator
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    normalized = str.split(thou).join('').replace(dec, '.');
    if ((normalized.match(/\./g) ?? []).length > 1) return NaN;
  } else if (lastComma >= 0) {
    const parts = str.split(',');
    normalized = parts.length > 2 ? parts.join('') : str.replace(',', '.'); // TR: single comma = decimal
  } else if (lastDot >= 0) {
    const parts = str.split('.');
    if (parts.length > 2) normalized = parts.join('');
    else normalized = parts[1].length === 3 ? parts.join('') : str; // TR: "1.234" = thousands
  } else normalized = str;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

/** Splits one CSV line honoring double quotes. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy (optional time) / yyyy-mm-dd → YYYY-MM-DD, or null. */
export function parseTrDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(t);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

type Col = 'date' | 'amount' | 'debit' | 'credit' | 'currency' | 'description' | 'counterparty' | 'ignore';
function classifyHeader(h: string): Col | null {
  const k = slugTr(h);
  if (!k) return null;
  if (/BAKIYE|BALANCE/.test(k)) return 'ignore';
  if (/VALOR/.test(k) && !/TARIH/.test(k)) return 'ignore';
  if (/TARIH|DATE/.test(k)) return 'date';
  if (/^BORC|DEBIT|CIKAN|GIDEN/.test(k)) return 'debit';
  if (/^ALACAK|CREDIT|GIREN|GELEN/.test(k)) return 'credit';
  if (/TUTAR|AMOUNT|MIKTAR/.test(k)) return 'amount';
  if (/DOVIZ|PARABIRIMI|CURRENCY|BIRIM|CCY/.test(k)) return 'currency';
  if (/ACIKLAMA|DESCRIPTION|DETAY|ISLEMADI|NARRATIVE/.test(k)) return 'description';
  if (/KARSITARAF|GONDEREN|ALICI|COUNTERPARTY|UNVAN|ADSOYAD|PAYEE|PAYER/.test(k)) return 'counterparty';
  return null;
}
function currencyFromText(s: string): string | null {
  if (/₺|\bTL\b|\bTRY\b/i.test(s)) return 'TRY';
  if (/€|\bEUR\b/i.test(s)) return 'EUR';
  if (/\$|\bUSD\b/i.test(s)) return 'USD';
  if (/£|\bGBP\b/i.test(s)) return 'GBP';
  return null;
}

/** Parses a bank statement CSV (Turkish bank export variants: ; or , separators, dd.mm.yyyy dates, 1.234,56 amounts).
 *  Header columns are recognised by name (Tarih/İşlem Tarihi, Açıklama, Tutar or Borç/Alacak, Döviz/Para Birimi, Karşı Taraf…);
 *  rows without a parsable date or amount (titles, totals) are skipped. Without a header, columns are date, description, amount[, currency].
 *  Debit (Borç) amounts become negative. Default currency TRY. */
export function parseBankCsv(csv: string): { bookedAt: string; amount: number; currency: string; description: string; counterparty: string | null }[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const count = (l: string, c: string) => splitCsvLine(l, c).length - 1;
  const sample = lines.slice(0, 10);
  const seps = [';', '\t', ','];
  const sep = seps.map((c) => ({ c, n: Math.max(...sample.map((l) => count(l, c))) })).sort((a, b) => b.n - a.n)[0].c;

  let headerIdx = -1;
  let cols: Col[] = [];
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cells = splitCsvLine(lines[i], sep);
    const kinds = cells.map(classifyHeader);
    if (kinds.includes('date') && (kinds.includes('amount') || kinds.includes('debit') || kinds.includes('credit'))) {
      headerIdx = i;
      cols = kinds.map((k) => k ?? 'ignore');
      break;
    }
  }
  if (headerIdx < 0) cols = ['date', 'description', 'amount', 'currency'];

  const out: { bookedAt: string; amount: number; currency: string; description: string; counterparty: string | null }[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    let date: string | null = null;
    let amount: number | null = null;
    let currency: string | null = null;
    const desc: string[] = [];
    let counterparty: string | null = null;
    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];
      const kind = cols[j];
      if (!cell) continue;
      switch (kind) {
        case 'date':
          date ??= parseTrDate(cell);
          break;
        case 'amount': {
          const n = parseTrNumber(cell);
          if (!Number.isNaN(n)) amount = n;
          currency ??= currencyFromText(cell);
          break;
        }
        case 'debit': {
          const n = parseTrNumber(cell);
          if (!Number.isNaN(n) && n !== 0) amount = -Math.abs(n);
          currency ??= currencyFromText(cell);
          break;
        }
        case 'credit': {
          const n = parseTrNumber(cell);
          if (!Number.isNaN(n) && n !== 0) amount = Math.abs(n);
          currency ??= currencyFromText(cell);
          break;
        }
        case 'currency':
          currency = currencyFromText(cell) ?? (/^[A-Z]{3}$/i.test(cell) ? cell.toUpperCase() : currency);
          break;
        case 'description':
          desc.push(cell);
          break;
        case 'counterparty':
          counterparty = cell;
          break;
      }
    }
    if (!date || amount == null) continue;
    out.push({ bookedAt: date, amount, currency: currency ?? 'TRY', description: desc.join(' ').trim(), counterparty });
  }
  return out;
}
