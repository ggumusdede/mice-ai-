// API-level preconditions for the browser scenarios (saves time; the scenarios then drive the UI for the part under test).
// Every helper takes a logged-in page (normally the admin) and goes through the same public HTTP contract as the UI.
import { expect, must, apiAs, RUN } from './harness.mjs';

export const REQUEST = (customer, pax = 60, extra = '') =>
  `Merhaba, 12-13 Mart 2027 tarihlerinde Kadıköy'de ${pax} kişilik bayi toplantısı için teklif rica ediyoruz. 20 SGL 20 DBL oda, ` +
  `tiyatro düzeni salon.${extra} Firma: ${customer}`;

let supplierCache = null;
export async function suppliers(page) {
  if (!supplierCache) {
    supplierCache = {};
    for (const s of (await must(page, 'GET', '/suppliers')).items) supplierCache[s.name] = s;
  }
  return supplierCache;
}

/** Intake via API → project with accommodation + hall items (other intake items cancelled). */
export async function createProject(page, { customer = `E2E Müşteri ${RUN}`, pax = 60, from = 'etkinlik@e2e-musteri.example', extra = '', keepItems = false } = {}) {
  const intake = await must(page, 'POST', '/intake', { channel: 'email', fromAddress: from, body: REQUEST(customer, pax, extra) });
  const projectId = intake.project.id;
  const detail = await must(page, 'GET', `/projects/${projectId}`);
  const acc = detail.items.find((i) => i.kind === 'accommodation');
  const hall = detail.items.find((i) => i.kind === 'hall');
  expect(acc && hall, 'accommodation + hall items from intake');
  await must(page, 'PATCH', `/items/${acc.id}`, { nights: 1 });
  if (!keepItems) for (const it of detail.items.filter((i) => !['accommodation', 'hall'].includes(i.kind))) await must(page, 'PATCH', `/items/${it.id}`, { status: 'cancelled' });
  return { projectId, acc: acc.id, hall: hall.id, code: detail.project.code };
}

export const accLines = (sgl, dbl) => [
  { description: 'Oda (SGL, BB)', kind: 'accommodation', quantity: 20, unit: 'room_night', nights: 1, unitPrice: sgl, vatIncluded: false, vatRate: 0.1, roomType: 'SGL', board: 'BB' },
  { description: 'Oda (DBL, BB)', kind: 'accommodation', quantity: 20, unit: 'room_night', nights: 1, unitPrice: dbl, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB' },
];
export const hallLines = (price = 1200) => [{ description: 'Salon (tiyatro)', kind: 'hall', quantity: 1, unit: 'day', unitPrice: price, vatIncluded: false, vatRate: 0.2 }];

export async function addOffer(page, itemId, supplierId, lines) {
  return must(page, 'POST', `/items/${itemId}/offers`, {
    supplierId, source: 'email', currency: 'EUR', lines, optionUntil: '2027-01-20', guaranteePax: 55, prepaymentRate: 0.3,
    paymentTerms: '%30 ön ödeme', cancellationTerms: '7 gün öncesine kadar ücretsiz',
  });
}

/** Two accommodation offers (Moda Sahil + Kalamış Marina) and one hall offer; selects the cheaper accommodation + hall. */
export async function arrangeOffers(page, p) {
  const sup = await suppliers(page);
  const moda = sup['Moda Sahil Otel'].id;
  const kalamis = sup['Kalamış Marina Hotel'].id;
  const oA = await addOffer(page, p.acc, moda, accLines(95, 110));
  const oB = await addOffer(page, p.acc, kalamis, accLines(120, 140));
  const oH = await addOffer(page, p.hall, moda, hallLines());
  await must(page, 'POST', `/items/${p.acc}/select-offer`, { offerId: oA.id });
  await must(page, 'POST', `/items/${p.hall}/select-offer`, { offerId: oH.id });
  Object.assign(p, { oA: oA.id, oB: oB.id, oH: oH.id, moda, kalamis });
  return p;
}

export const quoteBody = (p, markup = 0.2) => ({
  options: [
    { title: 'Moda Sahil', lines: [{ serviceItemId: p.acc, offerId: p.oA, markup }, { serviceItemId: p.hall, offerId: p.oH, markup }] },
    { title: 'Alternatif', lines: [{ serviceItemId: p.acc, offerId: p.oB, markup }, { serviceItemId: p.hall, offerId: p.oH, markup }] },
  ],
});

/** Builds a 2-option quote and (as admin, dev biometric) approves it when it needs approval. Returns the quote. */
export async function approvedQuote(page, p, markup = 0.2) {
  const quote = await must(page, 'POST', `/projects/${p.projectId}/quotes`, quoteBody(p, markup));
  if (quote.status === 'pending_approval') {
    const d = (await must(page, 'GET', `/decisions?projectId=${p.projectId}`)).items.find((x) => x.kind === 'quote_approval' && x.entityId === quote.id) ??
      (await must(page, 'GET', `/decisions?projectId=${p.projectId}`)).items.find((x) => x.kind === 'quote_approval');
    await must(page, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
  } else expect(quote.status === 'approved', `quote approved (${quote.status} ${JSON.stringify(quote.blockReasons)})`);
  p.quoteId = quote.id;
  return quote;
}

/** approvedQuote + send → public token */
export async function sentQuote(page, p, markup = 0.2) {
  await approvedQuote(page, p, markup);
  const sent = await must(page, 'POST', `/quotes/${p.quoteId}/send`);
  p.quoteLink = sent.approvalLink;
  p.quoteToken = sent.approvalLink.split('/q/')[1];
  return sent;
}

/** Project won: quote accepted on the public route (PO given → firm approval). */
export async function wonProject(page, opts = {}) {
  const p = await arrangeOffers(page, await createProject(page, opts));
  await sentQuote(page, p);
  await must(page, 'POST', `/public/quotes/${p.quoteToken}/accept`, { optionNo: 1, approverName: 'E2E Onaylayan', poNumber: `PO-${RUN}` }, { auth: false });
  p.code = (await must(page, 'GET', `/projects/${p.projectId}`)).project.code;
  return p;
}

/** Won + agency-template contract compared clean (billing info set) + approved + signed → payables / receivables exist. */
export async function signedProject(page, opts = {}) {
  const p = await wonProject(page, opts);
  await must(page, 'PATCH', `/projects/${p.projectId}`, { billingInfo: `E2E ${RUN} A.Ş., Kadıköy VD 1234567890, Moda Cad. 1 İstanbul` });
  const c = await must(page, 'POST', `/projects/${p.projectId}/contracts`, { supplierId: p.moda, serviceItemIds: [p.acc, p.hall], template: 'agency' });
  const cmp = await must(page, 'POST', `/contracts/${c.id}/compare`);
  expect(['clean', 'pending_approval'].includes(cmp.status), `contract compared clean (${cmp.status} ${JSON.stringify(cmp.diff).slice(0, 200)})`);
  for (let i = 0; i < 4; i++) {
    const open = (await must(page, 'GET', `/decisions?projectId=${p.projectId}`)).items.filter((d) => ['condition_risk', 'contract_approval'].includes(d.kind));
    if (!open.length) break;
    for (const d of open) await must(page, 'POST', `/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' }, reason: 'e2e' });
  }
  const me = (await must(page, 'GET', '/auth/me')).user;
  await must(page, 'POST', `/contracts/${c.id}/sign`, { signedBy: me.id, scanFileName: 'sozlesme-imzali.pdf' });
  p.contractId = c.id;
  p.code = (await must(page, 'GET', `/projects/${p.projectId}`)).project.code;
  return p;
}

/** Rules patch with automatic restore (returns the restore function). */
export async function withRules(page, patch, reason = 'e2e') {
  const before = await must(page, 'GET', '/rules');
  await must(page, 'PATCH', '/rules', { ...patch, reason });
  const keys = Object.keys(patch);
  return async () => {
    const restore = Object.fromEntries(keys.map((k) => [k, before[k]]));
    await must(page, 'PATCH', '/rules', { ...restore, reason: 'e2e: geri al' });
  };
}

export async function userByEmail(page, email) {
  const u = (await must(page, 'GET', '/users')).items.find((x) => x.email === email);
  expect(u, `user ${email}`);
  return u;
}

export async function openDecisions(page, filter = () => true) {
  return (await must(page, 'GET', '/decisions?status=open')).items.filter(filter);
}

export { apiAs };

/** Approves the open rfq_send decision(s) of a project (API, admin) and returns one-time supplier links for the item's sent RFQs. */
export async function rfqLinks(page, projectId, itemId) {
  for (const d of (await must(page, 'GET', `/decisions?projectId=${projectId}&status=open`)).items.filter((x) => x.kind === 'rfq_send')) {
    await must(page, 'POST', `/decisions/${d.id}/decide`, { action: 'approve' });
  }
  const item = (await must(page, 'GET', `/projects/${projectId}`)).items.find((i) => i.id === itemId);
  const out = [];
  for (const r of item.rfqs.filter((x) => ['sent', 'responded'].includes(x.status))) {
    const l = await must(page, 'POST', `/rfqs/${r.id}/link`);
    out.push({ rfqId: r.id, supplierId: r.supplierId, url: l.supplierLink });
  }
  return out;
}
