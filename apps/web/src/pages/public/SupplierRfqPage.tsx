import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { CURRENCIES, type OfferLine, type PublicOfferInput } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { dateRange, dateTime, money } from '../../lib/format';
import { PublicLayout } from '../../components/PublicLayout';
import { emptyLine, linesTotal, OfferLinesEditor } from '../../components/OfferLinesEditor';
import { Button, Callout, Card, FilePicker, InlineError, Loading, Select, TextInput } from '../../components/ui';
import { InvalidLink } from './InvalidLink';

/** §10 karma model: token link, no login, only this item; revisable until deadline, read-only after. */
export function SupplierRfqPage() {
  const t = useT();
  const { token = '' } = useParams();
  const res = useApi(() => api.public.rfq(token), [token]);
  const [form, setForm] = useState<PublicOfferInput | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentVersion, setSentVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!res.data || form) return;
    const v = res.data;
    const prev = v.previousVersions[v.previousVersions.length - 1];
    const base: OfferLine[] = prev?.lines?.length
      ? prev.lines
      : [emptyLine(v.item.kind, { description: v.item.description, quantity: v.item.quantity, nights: v.item.nights ?? undefined })];
    setForm({ currency: 'EUR', lines: base });
  }, [res.data, form]);

  if (res.error && !res.data) return <InvalidLink error={res.error} />;
  if (!res.data || !form) return <PublicLayout title={t.publicPages.rfqTitle}><Loading /></PublicLayout>;
  const v = res.data;
  const ro = v.readOnly;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.public.submitRfq(token, form);
      setSentVersion(r.version);
      void res.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const specs = Object.entries(v.item.specs ?? {}).filter(([, x]) => x !== null && x !== '' && typeof x !== 'object');

  return (
    <PublicLayout
      agencyName={v.agencyName}
      title={t.publicPages.rfqTitle}
      subtitle={<><span className="mono">{v.projectCode}</span> · {v.supplierName}</>}
    >
      <Card>
        <h2 className="card__title">{t.serviceKind[v.item.kind]} — {v.item.description}</h2>
        <dl className="kv">
          <div className="kv__row"><dt>{t.common.date}</dt><dd>{dateRange(v.item.dateFrom, v.item.dateTo)}</dd></div>
          <div className="kv__row"><dt>{t.common.quantity}</dt><dd>{v.item.quantity} {v.item.unit}{v.item.nights ? ` · ${v.item.nights} gece` : ''}</dd></div>
          {specs.map(([k, x]) => <div key={k} className="kv__row"><dt>{k}</dt><dd>{String(x)}</dd></div>)}
          <div className="kv__row"><dt>{t.publicPages.deadline}</dt><dd><strong>{dateTime(v.deadlineAt)}</strong></dd></div>
        </dl>
        <p className="muted small">{t.publicPages.rfqIntro}</p>
      </Card>

      {ro ? <Callout tone="warning" icon="info">{t.publicPages.readOnly}</Callout> : null}
      {sentVersion ? <Callout tone="success" icon="check">{t.publicPages.offerSent(sentVersion)}</Callout> : null}

      <form onSubmit={submit} className="stack stack--lg">
        <Card>
          <div className="form-grid">
            <Select label={t.common.currency} value={form.currency} disabled={ro} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <TextInput label={t.offers.optionUntil} type="date" disabled={ro} value={form.optionUntil ?? ''} onChange={(e) => setForm({ ...form, optionUntil: e.target.value || undefined })} />
          </div>
          <OfferLinesEditor lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} currency={form.currency} readOnly={ro} lockKind={v.item.kind} />
        </Card>
        <Card title="Koşullar">
          <fieldset className="form-grid" disabled={ro}>
            <TextInput label={t.offers.guaranteePax} type="number" min={0} value={form.guaranteePax ?? ''} onChange={(e) => setForm({ ...form, guaranteePax: e.target.value ? Number(e.target.value) : undefined })} />
            <TextInput label={t.offers.prepaymentRate} type="number" min={0} max={100} value={form.prepaymentRate !== undefined ? Math.round(form.prepaymentRate * 100) : ''} onChange={(e) => setForm({ ...form, prepaymentRate: e.target.value ? Number(e.target.value) / 100 : undefined })} />
            <TextInput label={t.offers.paymentTerms} className="span-full" value={form.paymentTerms ?? ''} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value || undefined })} />
            <TextInput label={t.offers.cancellationTerms} className="span-full" value={form.cancellationTerms ?? ''} onChange={(e) => setForm({ ...form, cancellationTerms: e.target.value || undefined })} />
            <TextInput label={t.offers.attritionTerms} className="span-full" value={form.attritionTerms ?? ''} onChange={(e) => setForm({ ...form, attritionTerms: e.target.value || undefined })} />
            <TextInput label={t.common.notes} className="span-full" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value || undefined })} />
          </fieldset>
          {!ro ? (
            <div className="row">
              <FilePicker label={t.publicPages.attach} accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg" onFile={async (f) => {
                try {
                  const r = await api.public.rfqFile(token, f);
                  setFiles((x) => [...x, r.fileName]);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }} />
              {files.length ? <span className="small muted">{files.join(', ')}</span> : null}
            </div>
          ) : null}
        </Card>
        <InlineError message={error} />
        {!ro ? (
          <div className="public__submit">
            <span className="muted">{t.common.total}: <strong>{money(linesTotal(form.lines), form.currency)}</strong></span>
            <Button type="submit" size="lg" icon="send" busy={busy} disabled={!form.lines.length || form.lines.some((l) => !l.description)}>{t.publicPages.submitOffer}</Button>
          </div>
        ) : null}
      </form>

      {v.previousVersions.length ? (
        <Card title={t.publicPages.previousVersions}>
          <ul className="list">
            {[...v.previousVersions].reverse().map((p) => (
              <li key={p.version} className="list__row">
                <span>v{p.version} · {dateTime(p.createdAt)}</span>
                <span className="muted">{p.lines.length} satır · {money(linesTotal(p.lines), form.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </PublicLayout>
  );
}
