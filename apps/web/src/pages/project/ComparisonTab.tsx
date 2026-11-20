import { useState } from 'react';
import { DEFAULT_RULES, type ChannelPriceInput, type MessageDraft, type NegotiationArgument, type ServiceItemDetail } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, eur, pct, signedPct } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, Checkbox, EmptyState, ErrorBox, InlineError, Loading, Pill, PriceClassPill, Select, TextInput } from '../../components/ui';
import { useProject } from './ProjectContext';

const ARGS: NegotiationArgument[] = ['volume', 'relationship', 'flexible_dates', 'payment_ease'];

export function ComparisonTab() {
  const t = useT();
  const { detail } = useProject();
  const withOffers = detail.items.filter((i) => i.offers.length > 0);
  if (!withOffers.length) return <EmptyState icon="chart" title={t.offers.noOffers} />;
  return (
    <div className="stack stack--lg">
      {withOffers.map((i) => <ItemComparison key={i.id} item={i} />)}
    </div>
  );
}

function ItemComparison({ item }: { item: ServiceItemDetail }) {
  const t = useT();
  const res = useApi(() => api.items.comparison(item.id), [item.id, item.offers.length]);
  const [negotiating, setNegotiating] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);

  return (
    <Card
      title={<>{t.serviceKind[item.kind]} · {item.description}</>}
      actions={item.kind === 'accommodation' ? <Button size="sm" variant="ghost" icon="plus" onClick={() => setChannelOpen((x) => !x)}>{t.comparison.channelPriceEntry}</Button> : null}
    >
      {channelOpen && res.data ? <ChannelPriceForm item={item} suppliers={res.data.suppliers} onDone={() => { setChannelOpen(false); void res.reload(); }} /> : null}
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {!res.data && res.loading ? <Loading /> : null}
      {res.data ? (
        <div className="compare">
          {res.data.evaluations.map((ev) => {
            const offer = res.data!.offers.find((o) => o.id === ev.offerId);
            const sup = res.data!.suppliers.find((s) => s.id === (offer?.supplierId ?? ev.normalized.supplierId));
            const roundsLeft = DEFAULT_RULES.maxNegotiationRounds - (offer?.negotiationRound ?? 0);
            return (
              <article key={ev.offerId} className={`compare__col ${item.selectedOfferId === ev.offerId ? 'is-selected' : ''}`}>
                <header className="compare__head">
                  <h3>{sup?.name ?? '—'}</h3>
                  <div className="chips">
                    <PriceClassPill value={ev.priceClass} />
                    {ev.candidateSupplier ? <Pill tone="warning" icon="alert">{t.project.candidateSupplier}</Pill> : null}
                  </div>
                </header>
                <dl className="kv kv--tight">
                  <div className="kv__row"><dt>{t.comparison.totalNet}</dt><dd className="num-strong">{eur(ev.normalized.totalNetExVatEur)}</dd></div>
                  <div className="kv__row"><dt>{t.comparison.perPerson}</dt><dd>{eur(ev.normalized.perPersonEur)}</dd></div>
                  {ev.normalized.perRoomNightEur !== null ? <div className="kv__row"><dt>{t.comparison.perRoomNight}</dt><dd>{eur(ev.normalized.perRoomNightEur)}</dd></div> : null}
                  <div className="kv__row"><dt>KDV / {t.publicPages.accTax}</dt><dd>{eur(ev.normalized.vatEur)} / {eur(ev.normalized.accommodationTaxEur)}</dd></div>
                  <div className="kv__row"><dt>{t.comparison.benchmark}</dt><dd>{t.comparison.benchmarkType[ev.benchmark.type]}{ev.benchmark.value !== null ? ` · ${eur(ev.benchmark.value)}` : ''}{ev.benchmark.sampleSize ? ` (n=${ev.benchmark.sampleSize})` : ''}</dd></div>
                  <div className="kv__row"><dt>{t.project.advantage}</dt><dd className={ev.advantage !== null && ev.advantage > 0 ? 'text-success' : ''}>{signedPct(ev.advantage)}</dd></div>
                  <div className="kv__row"><dt>{t.comparison.suggestedMarkup}</dt><dd>{ev.suggestedMarkup !== null ? <>{t.profit.markupShort} {pct(ev.suggestedMarkup)} · {t.profit.marginShort} {pct(ev.suggestedMarkup / (1 + ev.suggestedMarkup))}</> : '—'}</dd></div>
                  <div className="kv__row"><dt>{t.offers.optionUntil}</dt><dd>{date(offer?.optionUntil)}</dd></div>
                  {ev.normalized.fxRate !== 1 ? <div className="kv__row"><dt>Kur</dt><dd>{ev.normalized.fxRate}</dd></div> : null}
                </dl>
                {ev.normalized.hiddenCosts.length || ev.risks.length ? (
                  <div className="compare__risks">
                    <h4>{t.comparison.hiddenCosts}</h4>
                    <ul className="bullets small">
                      {ev.normalized.hiddenCosts.map((h, i) => <li key={`h${i}`} className={h.severity === 'critical' ? 'text-danger' : h.severity === 'warning' ? 'text-warning' : ''}>{h.description}</li>)}
                      {ev.risks.map((r, i) => <li key={`r${i}`}>{r}</li>)}
                    </ul>
                  </div>
                ) : null}
                {ev.priceClass !== 'good' && offer ? (
                  roundsLeft > 0 ? (
                    negotiating === offer.id ? (
                      <NegotiationForm offerId={offer.id} onDone={() => setNegotiating(null)} />
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setNegotiating(offer.id)}>
                        {t.comparison.negotiate} · {t.comparison.round} {(offer.negotiationRound ?? 0) + 1}/{DEFAULT_RULES.maxNegotiationRounds}
                      </Button>
                    )
                  ) : <p className="muted small">Maks. tur doldu — telefonla görüşün.</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

function NegotiationForm({ offerId, onDone }: { offerId: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [args, setArgs] = useState<Set<NegotiationArgument>>(new Set(['volume']));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  if (draft) {
    return (
      <div className="stack">
        <Callout tone="success" icon="check">{t.comparison.draftCreated}</Callout>
        <pre className="draft-preview">{draft.subject ? `${draft.subject}\n\n` : ''}{draft.body}</pre>
        <Button variant="ghost" size="sm" onClick={onDone}>{t.common.close}</Button>
      </div>
    );
  }
  return (
    <fieldset className="stack subcard">
      <legend className="field__label">{t.comparison.arguments}</legend>
      {ARGS.map((a) => (
        <Checkbox key={a} label={t.comparison.args[a]} checked={args.has(a)} onChange={(v) => { const s = new Set(args); if (v) s.add(a); else s.delete(a); setArgs(s); }} />
      ))}
      <p className="muted small">{t.comparison.competitorForbidden}</p>
      <InlineError message={error} />
      <div className="row-end">
        <Button variant="ghost" size="sm" onClick={onDone}>{t.common.cancel}</Button>
        <Button size="sm" busy={busy} disabled={!args.size} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setDraft(await api.offers.negotiate(offerId, [...args]));
            toast(t.comparison.draftCreated);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.comparison.negotiate}</Button>
      </div>
    </fieldset>
  );
}

function ChannelPriceForm({ item, suppliers, onDone }: { item: ServiceItemDetail; suppliers: { id: string; name: string }[]; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState<ChannelPriceInput>({
    supplierId: suppliers[0]?.id ?? '', date: item.dateFrom ?? '', roomType: 'DBL', board: 'BB', cancellation: 'flexible', price: 0, currency: 'EUR', source: '',
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="subcard form-grid" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api.channelPrices.add(f);
        onDone();
      } catch (err) {
        setError(errorMessage(err));
      }
    }}>
      <Select label={t.offers.supplier} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <TextInput label={t.common.date} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      <TextInput label={t.offers.roomType} value={f.roomType} onChange={(e) => setF({ ...f, roomType: e.target.value })} />
      <TextInput label={t.offers.board} value={f.board} onChange={(e) => setF({ ...f, board: e.target.value })} />
      <Select label="İptal koşulu" value={f.cancellation} onChange={(e) => setF({ ...f, cancellation: e.target.value as ChannelPriceInput['cancellation'] })}>
        <option value="flexible">Esnek</option>
        <option value="non_refundable">İadesiz</option>
      </Select>
      <TextInput label={t.project.channelPrice} type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
      <TextInput label={t.common.currency} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} />
      <TextInput label="Kaynak (OTA / toptancı)" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required />
      <p className="muted small span-full">Karşılaştırma koşulları birebir aynı olmalı: tarih, oda tipi, pansiyon, iptal koşulu.</p>
      <div className="span-full row-end">
        <InlineError message={error} />
        <Button variant="ghost" onClick={onDone}>{t.common.cancel}</Button>
        <Button type="submit">{t.common.save}</Button>
      </div>
    </form>
  );
}
