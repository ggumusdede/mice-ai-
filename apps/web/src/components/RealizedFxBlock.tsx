// Q5 kanıtlı gerçekleşen kâr: EUR and TL side by side (margin and markup separately), average collection / payment / project
// rates, FX gain / loss and an expandable "Kanıt" list of the money movements (mobile: cards, no wide table).
import { useState } from 'react';
import type { RealizedFx } from '@mice/shared';
import { useT } from '../i18n';
import { date, eur, money, num, pct, tl } from '../lib/format';
import { Pill } from './ui';

export function RealizedFxBlock({ title, value, plannedTry }: { title: string; value: RealizedFx | null | undefined; plannedTry?: { cost: number; sale: number; profit: number } | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!value || value.status === 'none') {
    return (
      <div className="profit" data-testid="realized-fx">
        <h3 className="profit__title">{title}</h3>
        <p className="muted">— {t.profit.noMovements}</p>
        {value?.reasons.filter((r) => r.code === 'no_fx_evidence').map((r) => <p key={r.code} className="muted small">{r.message}</p>)}
      </div>
    );
  }
  const v = value;
  const signed = (n: number | null, f: (x: number) => string) => (n == null ? '—' : `${n > 0 ? '+' : ''}${f(n)}`);
  return (
    <div className="profit" data-testid="realized-fx">
      <h3 className="profit__title">
        {title} <Pill tone={v.status === 'complete' ? 'success' : 'warning'}>{v.status === 'complete' ? t.profit.complete : t.profit.partial}</Pill>
      </h3>
      <div className="fx-cols">
        {(['eur', 'try'] as const).map((c) => {
          const f = c === 'eur' ? (n: number | null) => eur(n) : (n: number | null) => tl(n);
          return (
            <div key={c} className="fx-col">
              <div className="fx-col__head">{c === 'eur' ? t.profit.eur : t.profit.try}</div>
              <div className="profit__amount fx-col__profit">{f(v.profit[c])}</div>
              <dl className="fx-kv">
                <div><dt>{t.profit.cost}</dt><dd>{f(v.cost[c])}</dd></div>
                <div><dt>{t.profit.sale}</dt><dd>{f(v.revenue[c])}</dd></div>
                <div><dt title={t.profit.margin}>{t.profit.marginShort}</dt><dd className="num-strong">{pct(v.margin[c])}</dd></div>
                <div><dt title={t.profit.markup}>{t.profit.markupShort}</dt><dd className="num-strong">{pct(v.markup[c])}</dd></div>
                {c === 'try' && plannedTry ? <div><dt>{t.closing.planned}</dt><dd>{tl(plannedTry.profit)}</dd></div> : null}
              </dl>
            </div>
          );
        })}
      </div>
      <dl className="fx-kv fx-kv--rates">
        <div><dt>{t.profit.avgCollection}</dt><dd>{num(v.avgCollectionRate)}</dd></div>
        <div><dt>{t.profit.avgPayment}</dt><dd>{num(v.avgPaymentRate)}</dd></div>
        <div><dt>{t.profit.projectAvg}</dt><dd>{num(v.projectAvgRate)}</dd></div>
        <div><dt>{t.profit.quoteRate}</dt><dd>{num(v.quoteRate)}</dd></div>
        <div><dt>{t.profit.fxGainLoss}</dt><dd>{signed(v.fxGainLoss.eur, (n) => eur(n))} · {signed(v.fxGainLoss.try, (n) => tl(n))}</dd></div>
        <div><dt>{t.profit.timingFx}</dt><dd>{signed(v.collectionVsPaymentFx.try, (n) => tl(n))}</dd></div>
      </dl>
      <p className="profit__legend">{t.profit.margin} · {t.profit.markup}</p>
      {v.reasons.length ? <ul className="fx-reasons small">{v.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul> : null}
      <button type="button" className="link-button small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t.profit.evidence} · {t.profit.evidenceCount(v.evidence.length)} {open ? '▴' : '▾'}
      </button>
      {open ? (
        <div className="dv-cards">
          {v.evidence.map((e) => (
            <section key={e.movementId} className="dv-card">
              <h4 className="dv-card__title">{t.profit.type[e.type] ?? e.type} · {money(e.amount, e.currency)}</h4>
              <div className="muted small">{date(e.date)}{e.label ? ` · ${e.label}` : ''}</div>
              <div className="small">
                {e.eurTryRate != null ? `1 EUR = ${num(e.eurTryRate)} TL` : t.profit.rateUnknown} · {e.rateNote ?? t.profit.source[e.rateSource] ?? e.rateSource}
              </div>
              <div className="small">{eur(e.eur)} · {tl(e.try)} · <span className="muted">{t.profit.usage[e.usage] ?? e.usage}</span></div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
