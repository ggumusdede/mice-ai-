// §18.2 KVKK: personal data is pseudonymized BEFORE leaving the process (sent to the LLM API) and restored in
// outputs. Self-contained on purpose (no runtime dependency on @mice/domain).
//
// Masked: e-mail addresses, phone numbers (TR mobile/landline + international "+.."), IBANs, TCKN-like 11-digit
// national IDs, caller-supplied known names (guests, contact persons), and person names that follow an honorific
// ("Sayın Ayşe Yılmaz", "Mehmet Bey", "Mr. John Smith"). Company names are business data and are NOT masked.
// Limitation: binary PDFs/images cannot be masked in-process; see claude.ts.

export type PiiKind = 'EMAIL' | 'PHONE' | 'IBAN' | 'NATID' | 'PERSON';

export interface PseudonymMapping {
  /** token → original */
  tokens: Record<string, string>;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN_RE = /\bTR\s?\d{2}(?:\s?[\dA-Z]{4}){5}\s?[\dA-Z]{2}\b|\b[A-Z]{2}\d{2}(?:\s?[\dA-Z]{4}){3,7}(?:\s?[\dA-Z]{1,3})?\b/g;
const PHONE_RES: RegExp[] = [
  /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2})?/g, // international
  /(?<!\d|\d[.,])\(?0?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d|[.,]\d)/g, // TR mobile 05xx xxx xx xx
  /(?<!\d|\d[.,])\(?0\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d|[.,]\d)/g, // TR landline 0212 xxx xx xx
];
const NATID_RE = /(?<!\d|\d[.,])[1-9]\d{10}(?!\d|[.,]\d)/g;
const UP = 'A-ZÇĞİÖŞÜА-ЯЁ';
const LO = 'a-zçğıöşüа-яё';
const NAME = `[${UP}][${LO}]+(?:\\s+[${UP}][${LO}]+){0,2}`;
const HONORIFIC_BEFORE = new RegExp(`(?<=\\b(?:Sayın|Sn\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Prof\\.?|Господин|Госпожа)\\s+)${NAME}`, 'g');
const HONORIFIC_AFTER = new RegExp(`${NAME}(?=\\s+(?:Hanım|Hanim|Bey)\\b)`, 'g');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Pseudonymizer {
  private readonly toToken = new Map<string, string>();
  private readonly fromToken = new Map<string, string>();
  private readonly counters: Record<PiiKind, number> = { EMAIL: 0, PHONE: 0, IBAN: 0, NATID: 0, PERSON: 0 };
  private readonly names: string[];

  constructor(knownNames: (string | null | undefined)[] = []) {
    this.names = [...new Set(knownNames.filter((n): n is string => !!n && n.trim().length >= 3).map((n) => n.trim()))]
      .sort((a, b) => b.length - a.length);
  }

  private token(kind: PiiKind, original: string): string {
    const key = `${kind}:${original}`;
    const existing = this.toToken.get(key);
    if (existing) return existing;
    const t = `[${kind}_${++this.counters[kind]}]`;
    this.toToken.set(key, t);
    this.fromToken.set(t, original);
    return t;
  }

  mask(text: string): string {
    if (!text) return text;
    let out = text;
    out = out.replace(EMAIL_RE, (m) => this.token('EMAIL', m));
    out = out.replace(IBAN_RE, (m) => this.token('IBAN', m));
    for (const re of PHONE_RES) out = out.replace(re, (m) => (m.replace(/\D/g, '').length >= 10 ? this.token('PHONE', m) : m));
    out = out.replace(NATID_RE, (m) => this.token('NATID', m));
    for (const n of this.names) {
      out = out.replace(new RegExp(`(?<![${LO}${UP}])${escapeRe(n)}(?![${LO}])`, 'gi'), (m) => this.token('PERSON', m));
    }
    out = out.replace(HONORIFIC_BEFORE, (m) => this.token('PERSON', m));
    out = out.replace(HONORIFIC_AFTER, (m) => this.token('PERSON', m));
    return out;
  }

  /** Deep-masks every string inside a JSON-like value (object keys are kept). */
  maskDeep<T>(value: T): T {
    if (typeof value === 'string') return this.mask(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.maskDeep(v)) as unknown as T;
    if (value && typeof value === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = this.maskDeep(v);
      return o as T;
    }
    return value;
  }

  restore(text: string): string {
    if (!text || this.fromToken.size === 0) return text;
    return text.replace(/\[(EMAIL|PHONE|IBAN|NATID|PERSON)_\d+\]/g, (t) => this.fromToken.get(t) ?? t);
  }

  restoreDeep<T>(value: T): T {
    if (typeof value === 'string') return this.restore(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as unknown as T;
    if (value && typeof value === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = this.restoreDeep(v);
      return o as T;
    }
    return value;
  }

  get mapping(): PseudonymMapping {
    return { tokens: Object.fromEntries(this.fromToken) };
  }

  get size(): number {
    return this.fromToken.size;
  }
}

/** Functional API mirroring @mice/domain's pseudonymize/restorePseudonyms. */
export function maskPii(text: string, knownNames: string[] = []): { text: string; mapping: PseudonymMapping } {
  const p = new Pseudonymizer(knownNames);
  return { text: p.mask(text), mapping: p.mapping };
}

export function restorePii(text: string, mapping: PseudonymMapping): string {
  return text.replace(/\[(EMAIL|PHONE|IBAN|NATID|PERSON)_\d+\]/g, (t) => mapping.tokens[t] ?? t);
}

/** Collects person-like names from facts under keys that conventionally hold people (guest/contact/recipient...). */
export function collectNamesFromFacts(facts: unknown, out: string[] = []): string[] {
  const PERSON_KEY = /(guest|misafir|contact|kisi|kişi|recipient|alici|alıcı|attendee|participant|katilimci|katılımcı|person|name_?surname|ad_?soyad|fullName|contactName|guestName|signer|imza)/i;
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (PERSON_KEY.test(key) && /^[\p{L} .'-]{3,60}$/u.test(v) && !/\d/.test(v)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
  };
  walk(facts, '');
  return out;
}
