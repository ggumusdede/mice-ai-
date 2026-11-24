import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, money } from '../../lib/format';
import { unitLabel } from '../../components/OfferLinesEditor';
import { PublicLayout } from '../../components/PublicLayout';
import { Button, Callout, InlineError, Loading, TextArea, TextInput } from '../../components/ui';
import { InvalidLink } from './InvalidLink';

/** §7 Adım 4 Online onay: options side by side, select & approve; PO required per customer rule. */
export function CustomerQuotePage() {
  const t = useT();
  const { token = '' } = useParams();
  const res = useApi(() => api.public.quote(token), [token]);
  const [optionNo, setOptionNo] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [po, setPo] = useState('');
  const [mode, setMode] = useState<'accept' | 'revision'>('accept');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'accepted' | 'revision'>(null);

  if (res.error && !res.data) return <InvalidLink error={res.error} />;
  if (!res.data) return <PublicLayout title={t.publicPages.quoteTitle}><Loading /></PublicLayout>;
  const v = res.data;
  const poRequired = v.firmApproval === 'signed_or_po';
  const closed = ['accepted', 'rejected', 'superseded'].includes(v.status);

  return (
    <PublicLayout
      agencyName={v.agencyName}
      title={t.publicPages.quoteTitle}
      subtitle={<><span className="mono">{v.projectCode}</span>{v.customerName ? ` · ${v.customerName}` : ''}{v.optionUntil ? ` · ${t.publicPages.optionUntil}: ${date(v.optionUntil)}` : ''}</>}
    >
      {done === 'accepted' || v.status === 'accepted' ? <Callout tone="success" icon="check">{t.publicPages.accepted}</Callout> : null}
      {done === 'revision' ? <Callout tone="success" icon="check">{t.publicPages.revisionSent}</Callout> : null}

      <div className={`qopts qopts--${v.options.length}`} role="radiogroup" aria-label={t.quote.options}>
        {v.options.map((o) => {
          const sel = optionNo === o.optionNo;
          return (
            <article key={o.optionNo} className={`qopt ${sel ? 'is-selected' : ''}`}>
              <header className="qopt__head">
                <span className="qopt__no">{o.optionNo}</span>
                <h2 className="qopt__title">{o.title}</h2>
              </header>
              <ul className="qopt__lines">
                {o.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.description}<span className="muted small"> · {l.quantity} {unitLabel(l.unit)}</span></span>
                    <span className="nowrap">{money(l.total, v.currency)}</span>
                  </li>
                ))}
              </ul>
              <dl className="qopt__totals">
                <div><dt>{t.common.total}</dt><dd>{money(o.total, v.currency)}</dd></div>
                <div><dt>{t.publicPages.vat}</dt><dd>{money(o.vat, v.currency)}</dd></div>
                {o.accommodationTax ? <div><dt>{t.publicPages.accTax}</dt><dd>{money(o.accommodationTax, v.currency)}</dd></div> : null}
                <div className="qopt__grand"><dt>{t.publicPages.grandTotal}</dt><dd>{money(o.grandTotal, v.currency)}</dd></div>
              </dl>
              {!closed && !done ? (
                <Button
                  variant={sel ? 'primary' : 'secondary'}
                  className="btn--block"
                  icon={sel ? 'check' : undefined}
                  role="radio"
                  aria-checked={sel}
                  onClick={() => { setOptionNo(o.optionNo); setMode('accept'); }}
                >
                  {sel ? t.publicPages.selectedOption : t.publicPages.chooseOption}
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>

      {!closed && !done ? (
        <section className="card card--padded stack">
          {mode === 'accept' ? (
            <>
              <TextInput label={t.publicPages.approverName} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              {poRequired ? (
                <TextInput label={t.publicPages.poNumber} hint={t.publicPages.poRequired} value={po} onChange={(e) => setPo(e.target.value)} required />
              ) : null}
              <InlineError message={error} />
              <div className="row-between">
                <button type="button" className="link-btn" onClick={() => setMode('revision')}>{t.publicPages.requestRevision}</button>
                <Button
                  size="lg"
                  icon="check"
                  busy={busy}
                  disabled={!optionNo || !name.trim() || (poRequired && !po.trim())}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api.public.acceptQuote(token, { optionNo: optionNo!, approverName: name.trim(), poNumber: po.trim() || undefined });
                      setDone('accepted');
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.publicPages.acceptQuote}
                </Button>
              </div>
            </>
          ) : (
            <>
              <TextArea label={t.publicPages.revisionMessage} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required autoFocus />
              <InlineError message={error} />
              <div className="row-between">
                <button type="button" className="link-btn" onClick={() => setMode('accept')}>{t.common.back}</button>
                <Button
                  busy={busy}
                  disabled={!message.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api.public.reviseQuote(token, message.trim());
                      setDone('revision');
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.publicPages.requestRevision}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </PublicLayout>
  );
}
