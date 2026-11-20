import { describe, expect, it } from 'vitest';
import { MockAiService } from '../src/index.js';
import { CONTRACT_TEXT, INVOICE_TEXT, OFFER_TEXT, TODAY } from './fixtures.js';

const ai = new MockAiService();
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('MockAiService.parseSupplierOffer', () => {
  it('parses priced lines, VAT, option, prepayment, cancellation, guarantee, attrition, overtime', async () => {
    const r = await ai.parseSupplierOffer({ text: OFFER_TEXT, today: TODAY });
    const o = r.data;
    expect(r.action).toBe('document_reading');
    expect(o.supplierName).toBe('Kadıköy Grand Otel');
    expect(o.currency).toBe('EUR');
    expect(o.lines).toHaveLength(6); // total + overtime lines are not offer lines
    const dbl = o.lines[0];
    expect(dbl).toMatchObject({ kind: 'accommodation', roomType: 'DBL', board: 'BB', unitPrice: 120, quantity: 25, nights: 2, unit: 'oda', vatIncluded: true, vatRate: 10, accommodationTaxIncluded: false });
    expect(o.lines[1]).toMatchObject({ roomType: 'SGL', unitPrice: 100, quantity: 30, nights: 2 });
    expect(o.lines[2]).toMatchObject({ description: 'Salon kirası', kind: 'hall', unitPrice: 1500, quantity: 1, vatRate: 20 });
    expect(o.lines[3]).toMatchObject({ description: 'Coffee break', kind: 'fnb', unit: 'kişi', unitPrice: 12, quantity: 80 });
    expect(o.lines[4]).toMatchObject({ kind: 'fnb', unitPrice: 35, quantity: 160 }); // 80 kişi x 2 gün
    expect(o.lines[5]).toMatchObject({ kind: 'transfer', unit: 'araç', quantity: 4, unitPrice: 60 });
    expect(o.optionUntil).toBe('2027-02-15');
    expect(o.prepaymentRate).toBe(0.3);
    expect(o.guaranteePax).toBe(70);
    expect(o.cancellationTerms).toMatch(/İptal/);
    expect(o.attritionTerms).toMatch(/%10/);
    expect(o.overtimeTerms).toMatch(/fazla mesai/);
    expect(o.paymentTerms).toMatch(/ön ödeme/);
    expect(o.fieldConfidence.lines).toBeGreaterThan(0.8);
    expect(r.confidence).toBeGreaterThan(0.75);
  });

  it('handles KDV hariç / +KDV, TL amounts and per-line VAT rate', async () => {
    const r = await ai.parseSupplierOffer({
      text: 'ABC Transfer Hizmetleri\nHavalimanı transferi Vito: 3.250,00 TL x 6 araç + KDV\nGün boyu otobüs (46 kişilik): 18.000 TL %20 KDV hariç\nTeklif opsiyonu 10.01.2027 tarihine kadardır.',
      today: TODAY,
    });
    const o = r.data;
    expect(o.currency).toBe('TRY');
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ kind: 'transfer', unitPrice: 3250, quantity: 6, vatIncluded: false, vatRate: 20 });
    expect(o.lines[1]).toMatchObject({ kind: 'transfer', unitPrice: 18000, vatIncluded: false, vatRate: 20 });
    expect(o.optionUntil).toBe('2027-01-10');
  });

  it('reads an Excel export passed as CSV text file', async () => {
    const csv = 'Kalem;Birim Fiyat;Adet\nOda DBL BB;130 EUR;20 oda x 3 gece\nSalon kirası günlük;2.000 EUR;x 2 gün\n';
    const r = await ai.parseSupplierOffer({ file: { filename: 'teklif.csv', mimeType: 'text/csv', base64: b64(csv) }, today: TODAY });
    expect(r.data.lines).toHaveLength(2);
    expect(r.data.lines[0]).toMatchObject({ kind: 'accommodation', unitPrice: 130, quantity: 20, nights: 3 });
    expect(r.data.lines[1]).toMatchObject({ kind: 'hall', unitPrice: 2000, quantity: 2, unit: 'gün' });
  });

  it('cannot read PDFs without a model → confidence 0, needs human', async () => {
    const r = await ai.parseSupplierOffer({ file: { filename: 'teklif.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQK' }, today: TODAY });
    expect(r.confidence).toBe(0);
    expect(r.data.lines).toEqual([]);
    expect(r.data.notes).toMatch(/okunamadı/);
  });

  it('VAT unknown lowers confidence', async () => {
    const r = await ai.parseSupplierOffer({ text: 'Salon kirası: 1.000 EUR', today: TODAY });
    expect(r.data.fieldConfidence.vat).toBeLessThan(0.6);
    expect(r.confidence).toBeLessThan(0.8);
  });
});

describe('MockAiService.parseContract', () => {
  it('extracts contract fields for the offer↔contract diff', async () => {
    const r = await ai.parseContract({ text: CONTRACT_TEXT, today: TODAY });
    const c = r.data;
    expect(c.supplierName).toBe('Kadıköy Grand Otel');
    expect(c.customerName).toBe('Acme İlaç A.Ş.');
    expect(c.startDate).toBe('2027-03-12');
    expect(c.endDate).toBe('2027-03-14');
    expect(c.pax).toBe(80);
    expect(c.guaranteePax).toBe(70);
    expect(c.rooms).toEqual([
      { type: 'DBL', count: 25, nights: 2, unitPrice: 120 },
      { type: 'SGL', count: 30, nights: 2, unitPrice: 100 },
    ]);
    expect(c.unitPrices).toEqual([{ description: 'Salon kirası', unitPrice: 1500, quantity: 1 }]);
    expect(c.menu).toMatch(/öğle yemeği/);
    expect(c.hall).toMatch(/tiyatro/);
    expect(c.vatSeparated).toBe(true);
    expect(c.accommodationTaxSeparated).toBe(true);
    expect(c.currency).toBe('EUR');
    expect(c.totalAmount).toBe(14700);
    expect(c.prepaymentRate).toBe(0.3);
    expect(c.cancellationTerms).toMatch(/%50/);
    expect(c.attritionTerms).toMatch(/düşüş/);
    expect(c.billingInfo).toBeNull(); // empty field → reported by the diff
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('low confidence for an unrelated text', async () => {
    const r = await ai.parseContract({ text: 'Merhaba, nasılsınız?', today: TODAY });
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('MockAiService.parseInvoice', () => {
  it('reads an e-fatura and cross-checks net + VAT = total', async () => {
    const r = await ai.parseInvoice({ text: INVOICE_TEXT, today: TODAY });
    const i = r.data;
    expect(i.invoiceNo).toBe('ABC2027000000123');
    expect(i.supplierName).toBe('ABC Turizm A.Ş.');
    expect(i.issueDate).toBe('2027-03-20');
    expect(i.dueDate).toBe('2027-04-05');
    expect(i.currency).toBe('EUR');
    expect(i.netAmount).toBe(7500);
    expect(i.vatAmount).toBe(750);
    expect(i.totalAmount).toBe(8250);
    expect(i.lines).toEqual([
      { description: 'Konaklama hizmeti (25 DBL x 2 gece)', amount: 6000 },
      { description: 'Salon kirası', amount: 1500 },
    ]);
    expect(i.fieldConfidence.totalAmount).toBeGreaterThan(0.9);
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('inconsistent totals lower the amount confidences', async () => {
    const r = await ai.parseInvoice({ text: 'Fatura No: X1\nAra Toplam: 1.000,00 TL\nKDV %20: 200,00 TL\nGenel Toplam: 1.300,00 TL', today: TODAY });
    expect(r.data.totalAmount).toBe(1300);
    expect(r.data.currency).toBe('TRY');
    expect(r.data.fieldConfidence.totalAmount).toBeLessThan(0.6);
  });

  it('derives a missing total from net + VAT (English invoice)', async () => {
    const r = await ai.parseInvoice({ text: 'Invoice No: INV-2027/044\nInvoice date: March 20, 2027\nSubtotal: EUR 2,000.00\nVAT 20%: EUR 400.00', today: TODAY });
    expect(r.data.invoiceNo).toBe('INV-2027/044');
    expect(r.data.issueDate).toBe('2027-03-20');
    expect(r.data.netAmount).toBe(2000);
    expect(r.data.vatAmount).toBe(400);
    expect(r.data.totalAmount).toBe(2400);
  });
});
