import type { AutomationCounter, ContractFields, QuoteLine, QuoteOption, SupplierOffer, OfferLine, Supplier, RequestExtraction, Extracted } from '@mice/shared';
import { DEFAULT_RULES } from '@mice/shared';
import { profitSummary } from '../src/pricing.js';

export const rules = DEFAULT_RULES;
export const cal = DEFAULT_RULES.businessHours;
export const RATES = { EUR: 1, TRY: 35, USD: 1.1, GBP: 0.85 };

export function offer(over: Partial<SupplierOffer> = {}, lines: OfferLine[] = []): SupplierOffer {
  return {
    id: 'off-1', tenantId: 't', rfqId: null, serviceItemId: 'si-1', supplierId: 'sup-1', version: 1, source: 'form', currency: 'EUR',
    lines, optionUntil: null, guaranteePax: null, attritionTerms: null, paymentTerms: null, prepaymentRate: null,
    cancellationTerms: null, overtimeTerms: null, notes: null, confidence: null, verifiedBy: null, supersededBy: null,
    negotiationRound: 0, createdAt: '2026-11-16T09:00:00Z', ...over,
  };
}

export function qline(over: Partial<QuoteLine> = {}): QuoteLine {
  return {
    optionNo: 1, serviceItemId: 'si-acc', offerId: 'o1', description: 'Konaklama DBL', kind: 'accommodation', quantity: 40, unit: 'room_night',
    nights: 2, unitCostEur: 100, unitPriceEur: 125, markup: 0.25, vatRate: 0.1, valueAdd: false, supplierOptionUntil: '2027-01-15', ...over,
  };
}

export function qoption(optionNo: number, lines: QuoteLine[], cost = 100, sale = 125): QuoteOption {
  return { optionNo, title: `Seçenek ${optionNo}`, lines: lines.map((l) => ({ ...l, optionNo })), totals: profitSummary(cost, sale), vatEur: 0, accommodationTaxEur: 0, grandTotalCustomerCurrency: sale };
}

export function contractFields(over: Partial<ContractFields> = {}): ContractFields {
  return {
    supplierName: 'Hilton Bomonti', customerName: 'Acme İlaç A.Ş.', billingInfo: 'Acme İlaç A.Ş., Şişli VD 1234567890',
    startDate: '2027-03-12', endDate: '2027-03-14', pax: 80, guaranteePax: 72,
    rooms: [{ type: 'DBL', count: 40, nights: 2, unitPrice: 100 }],
    menu: 'Akşam yemeği set menü', hall: 'Balo salonu tiyatro düzeni',
    unitPrices: [{ description: 'Coffee break', unitPrice: 12, quantity: 160 }],
    vatSeparated: true, accommodationTaxSeparated: true, currency: 'EUR', totalAmount: 9920,
    paymentTerms: '%30 imzada, kalan etkinlikten 7 gün önce', prepaymentRate: 0.3, cancellationTerms: '30 gün öncesine kadar ücretsiz',
    attritionTerms: '%10 düşüş 14 gün önce', optionDate: '2027-01-15', ...over,
  };
}

export function counter(over: Partial<AutomationCounter> = {}): AutomationCounter {
  return { actionType: 'customer_quote', mode: 'approval', consecutiveClean: 0, threshold: 20, sampleRate: 0.05, promotedAt: null, demotedAt: null, totalAuto: 0, totalSampled: 0, sampleErrors: 0, ...over };
}

export function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup', tenantId: 't', name: 'Otel', kinds: ['accommodation', 'hall'], city: 'İstanbul', district: 'Şişli', lat: null, lng: null, capacityPax: 300, roomCount: 200,
    halls: [], status: 'accredited', segment: '5*', email: null, phone: null, contactName: null, commission: null, paymentTerms: null,
    performanceScore: 80, avgResponseHours: 10, accreditedBy: null, accreditedAt: null, ...over,
  };
}

const ex = <T>(value: T | null, confidence = 0.95): Extracted<T> => ({ value, confidence });
export function extraction(over: Partial<RequestExtraction> = {}): RequestExtraction {
  return {
    customerName: ex('Acme İlaç'), eventType: ex('toplantı'), startDate: ex('2027-03-12'), endDate: ex('2027-03-14'), dateFlexibility: ex(null, 0),
    pax: ex(80), roomsSgl: ex(0), roomsDbl: ex(40), city: ex('İstanbul'), district: ex('Şişli'), hallLayout: ex('tiyatro'), fnb: ex('tam pansiyon'),
    technical: ex(null, 0), transfer: ex(null, 0), budget: ex(null, 0), budgetCurrency: ex(null, 0), decisionDate: ex(null, 0), billingInfo: ex(null, 0),
    language: 'tr', ...over,
  };
}
export { ex };
