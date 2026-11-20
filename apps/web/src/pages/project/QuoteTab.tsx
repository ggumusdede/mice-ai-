import { useMemo, useState } from 'react';
import { CURRENCIES, DEFAULT_RULES, type BuildQuoteRequest, type Quote, type ServiceItemDetail } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { date, dateTime, eur, money, pct } from '../../lib/format';
import { optionTotals, preCheck, type BuilderLine } from '../../lib/quoteMath';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, CopyLink, EmptyState, InlineError, Pill, Select, TextArea, type Tone } from '../../components/ui';
import { useProject } from './ProjectContext';
import { supplierName, useSuppliers } from './useSuppliers';

interface OptionState { title: string; lines: BuilderLine[] }

const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral', blocked: 'danger', pending_approval: 'warning', approved: 'success', sent: 'accent', accepted: 'success',
  revision_requested: 'warning', rejected: 'danger', superseded: 'neutral',
};

function offersForItem(item: ServiceItemDetail) {
  return item.evaluations
    .filter((e) => item.offers.some((o) => o.id === e.offerId && !o.supersededBy))
    .sort((a, b) => a.normalized.totalNetExVatEur - b.normalized.totalNetExVatEur);
}

function initialLine(item: ServiceItemDetail, rank: number): BuilderLine {
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

export function QuoteTab() {
  const t = useT();
  const { detail } = useProject();
  const sorted = [...detail.quotes].sort((a, b) => b.version - a.version);
  return (
    <div className="stack stack--lg">
      {detail.items.length ? <QuoteBuilder /> : <EmptyState icon="doc" title={t.project.noItems} />}
      {sorted.length ? (
        <section className="stack">
          <h2 className="section-title">{t.quote.existing}</h2>
          {sorted.map((q) => <QuoteCard key={q.id} q={q} />)}
        </section>
      ) : null}
    </div>
  );
}

function QuoteBuilder() {
  const t = useT();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { detail, reload } = useProject();
  const { byId } = useSuppliers();
  const items = detail.items;
  const [currency, setCurrency] = useState<string>(detail.customer?.rules.preferredCurrency ?? 'EUR');
  const [options, setOptions] = useState<OptionState[]>(() => {
    const n = Math.max(DEFAULT_RULES.quoteOptionsMin, Math.min(DEFAULT_RULES.quoteOptionsMax, Math.max(...items.map((i) => offersForItem(i).length), 1)));
    return Array.from({ length: Math.min(n, DEFAULT_RULES.quoteOptionsMin) }, (_, k) => ({ title: `Seçenek ${k + 1}`, lines: items.map((i) => initialLine(i, k)) }));
  });
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Quote | null>(null);

  const totals = useMemo(() => options.map((o) => optionTotals(o.lines)), [options]);
  const issues = totals.map((tt) => preCheck(tt, { targetMarginMin: DEFAULT_RULES.targetMarginMin }));
  const belowTarget = totals.some((tt) => tt.saleEur > 0 && tt.margin < DEFAULT_RULES.targetMarginMin);

  const setLine = (oi: number, li: number, patch: Partial<BuilderLine>) =>
    setOptions((os) => os.map((o, i) => (i === oi ? { ...o, lines: o.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : o)));

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: BuildQuoteRequest = {
        currency,
        options: options.map((o) => ({
          title: o.title,
          lines: o.lines.filter((l) => l.include).map((l) => ({
            serviceItemId: l.serviceItemId, offerId: l.offerId, markup: l.valueAdd ? undefined : l.markup, unitPriceEur: l.valueAdd ? l.unitPriceEur : undefined,
          })),
        })),
        marginOverrideReason: overrideReason.trim() || undefined,
      };
      const q = await api.projects.buildQuote(detail.project.id, body);
      setResult(q);
      await reload();
      toast(t.quoteStatus[q.status], q.status === 'blocked' ? 'danger' : q.status === 'pending_approval' ? 'neutral' : undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={t.quote.builder}
      actions={
        <div className="row">
          <label className="inline-field">
            <span className="small muted">{t.quote.currency}</span>
            <select className="input select input--sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {options.length < DEFAULT_RULES.quoteOptionsMax ? (
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setOptions((os) => [...os, { title: `Seçenek ${os.length + 1}`, lines: items.map((i) => initialLine(i, os.length)) }])}>
              {t.quote.addOption}
            </Button>
          ) : null}
        </div>
      }
    >
      <p className="muted small">{t.quote.optionCountHint(DEFAULT_RULES.quoteOptionsMin, DEFAULT_RULES.quoteOptionsMax)} İç hesap EUR; müşteri para birimine sunucu çevirir.</p>
      <div className={`qb qb--${options.length}`}>
        {options.map((o, oi) => (
          <section key={oi} className="qb__opt" aria-label={o.title}>
            <header className="qb__head">
              <label className="sr-only" htmlFor={`opt-title-${oi}`}>{t.quote.optionTitle}</label>
              <input id={`opt-title-${oi}`} className="input qb__title" value={o.title} onChange={(e) => setOptions((os) => os.map((x, i) => (i === oi ? { ...x, title: e.target.value } : x)))} />
              {options.length > DEFAULT_RULES.quoteOptionsMin ? (
                <button type="button" className="icon-btn" aria-label={`${t.common.remove}: ${o.title}`} onClick={() => setOptions((os) => os.filter((_, i) => i !== oi))}>×</button>
              ) : null}
            </header>
            <ul className="qb__lines">
              {o.lines.map((l, li) => {
                const item = items[li];
                const evs = offersForItem(item);
                const ev = evs.find((e) => e.offerId === l.offerId);
                return (
                  <li key={item.id} className={`qb__line ${l.include ? '' : 'is-off'}`}>
                    <div className="qb__line-head">
                      <label className="check check--inline">
                        <input type="checkbox" checked={l.include} onChange={(e) => setLine(oi, li, { include: e.target.checked })} />
                        <span><strong>{t.serviceKind[item.kind]}</strong> · {item.description}</span>
                      </label>
                      {item.valueAdd ? <Pill tone="purple">Katma değer</Pill> : ev ? <span className="small muted">{eur(l.costEur)}</span> : null}
                    </div>
                    {l.include ? (
                      item.valueAdd ? (
                        <div className="qb__ctrl">
                          <label className="inline-field">
                            <span className="small muted">{t.quote.unitPrice} / {item.unit}</span>
                            <input className="input input--sm" type="number" min={0} step="0.01" value={l.unitPriceEur ?? 0} onChange={(e) => setLine(oi, li, { unitPriceEur: Number(e.target.value) })} />
                          </label>
                          <span className="small muted">{t.quote.valueAddHint}</span>
                        </div>
                      ) : evs.length ? (
                        <div className="qb__ctrl">
                          <label className="inline-field">
                            <span className="small muted">{t.quote.offer}</span>
                            <select className="input select input--sm" value={l.offerId ?? ''} onChange={(e) => {
                              const nev = evs.find((x) => x.offerId === e.target.value);
                              setLine(oi, li, { offerId: e.target.value, costEur: nev?.normalized.totalNetExVatEur ?? 0, markup: nev?.suggestedMarkup ?? l.markup });
                            }}>
                              {evs.map((x) => (
                                <option key={x.offerId} value={x.offerId}>
                                  {supplierName(byId, x.normalized.supplierId)} — {eur(x.normalized.totalNetExVatEur)}{x.candidateSupplier ? ' (aday)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="inline-field inline-field--num">
                            <span className="small muted">{t.profit.markupShort} %</span>
                            <input className="input input--sm" type="number" step="0.5" value={+(l.markup * 100).toFixed(2)} onChange={(e) => setLine(oi, li, { markup: Number(e.target.value) / 100 })} />
                          </label>
                          {ev?.suggestedMarkup !== null && ev?.suggestedMarkup !== undefined && Math.abs(ev.suggestedMarkup - l.markup) > 1e-6 ? (
                            <button type="button" className="link-btn small" onClick={() => setLine(oi, li, { markup: ev.suggestedMarkup! })}>
                              {t.quote.markupSuggestion}: {pct(ev.suggestedMarkup)}
                            </button>
                          ) : null}
                          {ev?.candidateSupplier ? <Pill tone="warning" icon="alert">{t.project.candidateSupplier}</Pill> : null}
                        </div>
                      ) : <p className="muted small">{t.quote.noOffer}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <footer className="qb__totals">
              <div className="qb__total-row"><span>{t.profit.cost}</span><span>{eur(totals[oi].costEur)}</span></div>
              <div className="qb__total-row qb__total-row--strong"><span>{t.profit.sale}</span><span>{eur(totals[oi].saleEur)}</span></div>
              <div className="qb__total-row"><span>{t.profit.profit}</span><span>{eur(totals[oi].profitEur)}</span></div>
              <div className="qb__total-row"><span title={t.profit.margin}>{t.profit.marginShort}</span><span className={totals[oi].margin < DEFAULT_RULES.targetMarginMin ? 'text-danger' : ''}>{pct(totals[oi].margin)}</span></div>
              <div className="qb__total-row"><span title={t.profit.markup}>{t.profit.markupShort}</span><span>{pct(totals[oi].markup)}</span></div>
              {issues[oi].map((m, i) => <p key={i} className="small text-warning">{m}</p>)}
            </footer>
          </section>
        ))}
      </div>

      {belowTarget && isAdmin ? (
        <TextArea label={t.quote.marginOverride} rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
      ) : null}

      {result ? <QuoteResult q={result} /> : null}
      <InlineError message={error} />
      <div className="row-end">
        <Button size="lg" icon="check" busy={busy} disabled={options.length < DEFAULT_RULES.quoteOptionsMin} onClick={() => void build()}>{t.quote.build}</Button>
      </div>
    </Card>
  );
}

function QuoteResult({ q }: { q: Quote }) {
  const t = useT();
  return (
    <div className="stack">
      {q.blockReasons.length ? (
        <Callout tone="danger" icon="alert" title={t.quote.blockReasons}>
          <ul className="bullets">{q.blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Callout>
      ) : q.status === 'pending_approval' ? (
        <Callout tone="warning" icon="inbox">{t.quoteStatus.pending_approval} — karar kutusuna düştü.</Callout>
      ) : (
        <Callout tone="success" icon="check">{t.quoteStatus[q.status]}</Callout>
      )}
    </div>
  );
}

function QuoteCard({ q }: { q: Quote }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(q.approvalLink ?? null);
  return (
    <Card
      title={<>v{q.version} <Pill tone={STATUS_TONE[q.status] ?? 'neutral'}>{t.quoteStatus[q.status]}</Pill></>}
      actions={
        <div className="row">
          <Button size="sm" variant="ghost" icon="doc" onClick={() => void api.quotes.pdf(q.id).catch((e) => toast(errorMessage(e), 'danger'))}>{t.quote.pdf}</Button>
          {q.status === 'approved' ? (
            <Button size="sm" icon="send" busy={busy} onClick={async () => {
              setBusy(true);
              try {
                const s = await api.quotes.send(q.id);
                setLink(s.approvalLink ?? null);
                await reload();
                toast(t.quoteStatus.sent);
              } catch (e) {
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}>{t.quote.send}</Button>
          ) : null}
        </div>
      }
    >
      <div className="muted small row">
        <span>{q.currency} · 1 EUR = {q.fxRate} ({q.fxSource}, {date(q.fxDate)})</span>
        {q.optionUntil ? <span>{t.offers.optionUntil}: {date(q.optionUntil)}</span> : null}
        {q.sentAt ? <span>{t.quoteStatus.sent}: {dateTime(q.sentAt)}</span> : null}
        {q.openedAt ? <span>{t.quote.opened}: {dateTime(q.openedAt)}</span> : null}
        {q.acceptedOptionNo ? <span>{t.quote.accepted}: {q.acceptedOptionNo}</span> : null}
      </div>
      {q.appliedCustomerRules.length ? (
        <div className="chips">
          <span className="small muted">{t.quote.appliedRules}:</span>
          {q.appliedCustomerRules.map((r) => <Pill key={r} tone="purple">{r}</Pill>)}
        </div>
      ) : null}
      {q.blockReasons.length ? (
        <Callout tone="danger" icon="alert" title={t.quote.blockReasons}><ul className="bullets">{q.blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul></Callout>
      ) : null}
      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">{t.quote.options}</th>
              <th scope="col" className="num">{t.profit.cost}</th>
              <th scope="col" className="num">{t.profit.sale}</th>
              <th scope="col" className="num">{t.profit.profit}</th>
              <th scope="col" className="num">{t.profit.marginShort}</th>
              <th scope="col" className="num">{t.profit.markupShort}</th>
              <th scope="col" className="num">{t.publicPages.grandTotal} ({q.currency})</th>
            </tr>
          </thead>
          <tbody>
            {q.options.map((o) => (
              <tr key={o.optionNo} className={q.acceptedOptionNo === o.optionNo ? 'is-selected' : undefined}>
                <td>{o.optionNo}. {o.title}</td>
                <td className="num">{eur(o.totals.costEur)}</td>
                <td className="num">{eur(o.totals.saleEur)}</td>
                <td className="num">{eur(o.totals.profitEur)}</td>
                <td className="num">{pct(o.totals.margin)}</td>
                <td className="num">{pct(o.totals.markup)}</td>
                <td className="num">{money(o.grandTotalCustomerCurrency, q.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {link ? <div className="row"><span className="small muted">{t.quote.approvalLink}:</span><CopyLink url={link} /></div> : null}
    </Card>
  );
}
