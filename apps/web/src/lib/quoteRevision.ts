// Q9 hızlı revizyon: the quote builder opens an existing revision prefilled; only what changed is edited.
import type { Quote, ServiceItemDetail } from '@mice/shared';
import type { BuilderLine } from './quoteMath';

export interface OptionState { title: string; lines: BuilderLine[] }

/** Current (non-superseded) offer evaluations of an item, cheapest first. */
export function offersForItem(item: ServiceItemDetail) {
  return item.evaluations
    .filter((e) => item.offers.some((o) => o.id === e.offerId && !o.supersededBy))
    .sort((a, b) => a.normalized.totalNetExVatEur - b.normalized.totalNetExVatEur);
}

export function initialLine(item: ServiceItemDetail, rank: number): BuilderLine {
  const evs = offersForItem(item);
  const chosen = rank === 0 ? evs.find((e) => e.offerId === item.selectedOfferId) ?? evs[0] : evs[rank] ?? evs[0];
  return {
    serviceItemId: item.id,
    include: true,
    offerId: item.valueAdd ? null : chosen?.offerId ?? null,
    costEur: item.valueAdd ? 0 : chosen?.normalized.totalNetExVatEur ?? 0,
    markup: chosen?.suggestedMarkup ?? 0.1,
    valueAdd: item.valueAdd,
    quantity: item.quantity,
    unitPriceEur: item.valueAdd ? 0 : undefined,
  };
}

/** "Rev.2" — revision label of a quote version (same quote file / project code). */
export const revisionLabel = (version: number) => `Rev.${version}`;

/** Builder state reproducing `q`: same options, offers (a superseded offer follows the supplier's latest version), markups,
 *  value-add prices. Items not in an option are unchecked; costs come from the CURRENT data (e.g. new pax). */
export function prefillFromQuote(items: ServiceItemDetail[], q: Quote): OptionState[] {
  return q.options.map((o) => ({
    title: o.title,
    lines: items.map((item) => {
      const ql = o.lines.find((l) => l.serviceItemId === item.id);
      const base = initialLine(item, 0);
      if (!ql) return { ...base, include: false };
      if (item.valueAdd || ql.valueAdd) return { ...base, include: true, offerId: null, costEur: 0, valueAdd: true, unitPriceEur: ql.unitPriceEur };
      const evs = offersForItem(item);
      let ev = evs.find((e) => e.offerId === ql.offerId);
      if (!ev) {
        const supplierId = item.offers.find((x) => x.id === ql.offerId)?.supplierId;
        ev = supplierId ? evs.find((e) => e.normalized.supplierId === supplierId) : undefined;
      }
      if (!ev) return { ...base, include: true };
      return { ...base, include: true, offerId: ev.offerId, costEur: ev.normalized.totalNetExVatEur, markup: ql.markup };
    }),
  }));
}

/** The latest live revision that may be revised (not superseded, not accepted). */
export function canRevise(q: Quote, outcome: string): boolean {
  return q.status !== 'superseded' && !q.supersededBy && q.status !== 'accepted' && (outcome === 'open' || outcome === 'won');
}
