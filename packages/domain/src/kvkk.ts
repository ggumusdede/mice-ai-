// §17.9 Rıza bazlı saklama
const DAY = 86_400_000;
const isoDay = (s: string) => s.slice(0, 10);

/** eventEnd (ISO date or datetime) + retentionDays → ISO date (YYYY-MM-DD). */
export function retentionUntil(eventEnd: string, retentionDays: number): string {
  const t = Date.parse(isoDay(eventEnd) + 'T00:00:00Z');
  if (Number.isNaN(t)) throw new Error(`retentionUntil: invalid date "${eventEnd}"`);
  return new Date(t + Math.max(0, Math.trunc(retentionDays)) * DAY).toISOString().slice(0, 10);
}

/** Should this guest be anonymized now? consent → keep (unless withdrawn → anonymize after retention or immediately if past).
 *  No consent → anonymize once the retention date has passed (retentionUntil is the last day data may be kept).
 *  Withdrawn consent without a retention date → anonymize immediately. Already anonymized → false. */
export function shouldAnonymize(g: { consentReuse: boolean; consentWithdrawnAt: string | null; anonymizedAt: string | null; retentionUntil: string | null }, now: Date): boolean {
  if (g.anonymizedAt) return false;
  const withdrawn = !!g.consentWithdrawnAt;
  if (g.consentReuse && !withdrawn) return false;
  if (!g.retentionUntil) return withdrawn;
  const expiry = Date.parse(isoDay(g.retentionUntil) + 'T00:00:00Z') + DAY; // end of the retention day (UTC)
  return now.getTime() >= expiry;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// TR numbers: +90 / 0090 / 0 prefix, optional (area), 3-3-2-2 grouping; bare 10 digits only when mobile (5xx)
const TR_PHONE_RE = /(?<![\d+])((?:\+|00)90[\s.-]*|0[\s.-]*)?\(?([2-5]\d{2})\)?[\s.-]*(\d{3})[\s.-]*(\d{2})[\s.-]*(\d{2})(?!\d)/g;
const INTL_PHONE_RE = /(?<![\d\w])\+(?!90)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pseudonymization for LLM calls (§18.2): replaces names/emails/phones with stable tokens; returns mapping to restore.
 *  Same value (emails case-insensitive, phones by digits, names case-insensitive) → same token, e.g. [PERSON_1], [EMAIL_1], [PHONE_1]. */
export function pseudonymize(text: string, knownNames: string[]): { text: string; mapping: Record<string, string> } {
  const mapping: Record<string, string> = {};
  const byKey = new Map<string, string>();
  const counters = { PERSON: 0, EMAIL: 0, PHONE: 0 };
  const tokenFor = (kind: keyof typeof counters, key: string, original: string) => {
    const k = `${kind}:${key}`;
    let tok = byKey.get(k);
    if (!tok) {
      tok = `[${kind}_${++counters[kind]}]`;
      byKey.set(k, tok);
      mapping[tok] = original;
    }
    return tok;
  };

  let out = text.replace(EMAIL_RE, (m) => tokenFor('EMAIL', m.toLowerCase(), m));
  out = out.replace(TR_PHONE_RE, (m, prefix: string | undefined, area: string) => {
    const hasSeparators = /[\s.()-]/.test(m);
    if (!prefix && !hasSeparators && !area.startsWith('5')) return m; // bare 10-digit non-mobile: likely tax no / reference
    const digits = m.replace(/\D/g, '');
    const national = digits.slice(-10);
    return tokenFor('PHONE', national, m.trim());
  });
  out = out.replace(INTL_PHONE_RE, (m) => tokenFor('PHONE', m.replace(/\D/g, ''), m.trim()));

  const names = [...new Set(knownNames.map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = escapeRe(name).replace(/ /g, '\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(re, (m) => tokenFor('PERSON', name.toLocaleLowerCase('tr-TR'), name));
  }
  return { text: out, mapping };
}

export function restorePseudonyms(text: string, mapping: Record<string, string>): string {
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const re = new RegExp(keys.map(escapeRe).join('|'), 'g');
  return text.replace(re, (m) => mapping[m] ?? m);
}
