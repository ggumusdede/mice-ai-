import { describe, expect, it } from 'vitest';
import { Pseudonymizer, collectNamesFromFacts, maskPii, restorePii } from '../src/index.js';

describe('PII pseudonymization (§18.2)', () => {
  const text = `Sayın Ayşe Yılmaz,
Rooming list: Mehmet Öztürk, Can Demir. TCKN 12345678901.
İletişim: ayse.yilmaz@acme.com.tr, 0532 123 45 67, +90 212 555 12 34, +44 20 7946 0958
IBAN: TR12 0006 4000 0011 2345 6789 01
Kemal Bey arayacak. Fiyat 1.500 EUR, tarih 12.03.2027, 80 kişi, 30 SGL.`;

  it('masks emails, phones, IBAN, national IDs, honorific and known names; keeps business data', () => {
    const p = new Pseudonymizer(['Mehmet Öztürk', 'Can Demir']);
    const m = p.mask(text);
    for (const secret of ['Ayşe Yılmaz', 'Mehmet Öztürk', 'Can Demir', '12345678901', 'ayse.yilmaz@acme.com.tr', '0532 123 45 67', '+90 212 555 12 34', '+44 20 7946 0958', 'TR12 0006', 'Kemal']) {
      expect(m).not.toContain(secret);
    }
    // business data untouched
    for (const keep of ['1.500 EUR', '12.03.2027', '80 kişi', '30 SGL', 'Sayın', 'Bey']) expect(m).toContain(keep);
    expect(m).toMatch(/\[EMAIL_1\]/);
    expect(m).toMatch(/\[PHONE_\d\]/);
    expect(m).toMatch(/\[PERSON_\d\]/);
    expect(p.restore(m)).toBe(text);
  });

  it('same value → same token; restoreDeep/maskDeep round-trip objects', () => {
    const p = new Pseudonymizer(['Ali Veli']);
    const facts = { guest: 'Ali Veli', notes: ['Ali Veli VIP', 'tel 0533 222 33 44'], nested: { email: 'a@b.co' }, pax: 3 };
    const masked = p.maskDeep(facts);
    expect(masked.guest).toBe(masked.notes[0].split(' ')[0]);
    expect(JSON.stringify(masked)).not.toMatch(/Ali Veli|0533|a@b\.co/);
    expect(masked.pax).toBe(3);
    expect(p.restoreDeep(masked)).toEqual(facts);
  });

  it('functional API mirrors @mice/domain pseudonymize/restorePseudonyms', () => {
    const { text: m, mapping } = maskPii('Mail: x@y.com — Sn. Elif Kara', []);
    expect(m).toBe('Mail: [EMAIL_1] — Sn. [PERSON_1]');
    expect(restorePii(`Cevap: ${m}`, mapping)).toBe('Cevap: Mail: x@y.com — Sn. Elif Kara');
  });

  it('unknown tokens are left as-is on restore; prices are not phones', () => {
    const p = new Pseudonymizer();
    expect(p.restore('[PERSON_9] hello')).toBe('[PERSON_9] hello');
    expect(p.mask('Toplam 1.234.567,00 TL ve 250 EUR x 25 oda')).toBe('Toplam 1.234.567,00 TL ve 250 EUR x 25 oda');
  });

  it('collects person names from conventional fact keys only', () => {
    const names = collectNamesFromFacts({ customerName: 'Acme İlaç', contactName: 'Zeynep Kaya', guests: ['Can Demir', 'Ece Ak'], pax: 80, hotel: 'Grand Otel' });
    expect(names).toEqual(['Zeynep Kaya', 'Can Demir', 'Ece Ak']);
  });
});
