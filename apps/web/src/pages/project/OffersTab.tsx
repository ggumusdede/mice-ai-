import { useState } from 'react';
import { CURRENCIES, type Currency, type ManualOfferInput, type ServiceItemDetail, type SupplierOffer } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { date, relative } from '../../lib/format';
import { emptyLine, linesTotal, OfferLinesEditor } from '../../components/OfferLinesEditor';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, ConfidenceTag, EmptyState, FilePicker, InlineError, Pill, Segmented, Select, TextArea, TextInput } from '../../components/ui';
import { money } from '../../lib/format';
import { useProject } from './ProjectContext';
import { supplierName, useSuppliers } from './useSuppliers';

const THRESHOLD = 0.8;

export function OffersTab() {
  const t = useT();
  const { detail } = useProject();
  if (!detail.items.length) return <EmptyState icon="doc" title={t.project.noItems} />;
  return (
    <div className="stack stack--lg">
      {detail.items.map((item) => <ItemOffers key={item.id} item={item} />)}
    </div>
  );
}

function ItemOffers({ item }: { item: ServiceItemDetail }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const { byId, suppliers } = useSuppliers();
  const [mode, setMode] = useState<'none' | 'parse' | 'manual'>('none');
  const [verifying, setVerifying] = useState<SupplierOffer | null>(null);
  const [showOld, setShowOld] = useState(false);
  const current = item.offers.filter((o) => !o.supersededBy);
  const old = item.offers.filter((o) => o.supersededBy);
  const rfqSupplierIds = Array.from(new Set(item.rfqs.map((r) => r.supplierId)));
  const supplierOptions = (rfqSupplierIds.length ? rfqSupplierIds.map((id) => byId.get(id)).filter(Boolean) : suppliers.filter((s) => s.kinds.includes(item.kind))) as typeof suppliers;

  const select = async (o: SupplierOffer) => {
    try {
      await api.items.selectOffer(item.id, o.id);
      await reload();
      toast(t.offers.selected);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  return (
    <Card
      title={<>{t.serviceKind[item.kind]} · {item.description}</>}
      actions={
        <div className="row">
          <Button size="sm" variant={mode === 'parse' ? 'primary' : 'secondary'} icon="sparkle" onClick={() => setMode(mode === 'parse' ? 'none' : 'parse')}>{t.offers.parse}</Button>
          <Button size="sm" variant={mode === 'manual' ? 'primary' : 'secondary'} icon="plus" onClick={() => setMode(mode === 'manual' ? 'none' : 'manual')}>{t.offers.manual}</Button>
        </div>
      }
    >
      {mode === 'parse' ? <ParseOffer item={item} supplierOptions={supplierOptions} onDone={(o) => { setMode('none'); if (o.confidence !== null && o.confidence < THRESHOLD) setVerifying(o); }} /> : null}
      {mode === 'manual' ? <ManualOffer item={item} supplierOptions={supplierOptions} onDone={() => setMode('none')} /> : null}

      {current.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.offers.supplier}</th>
                <th scope="col">{t.offers.version}</th>
                <th scope="col">{t.offers.source}</th>
                <th scope="col" className="num">{t.common.total}</th>
                <th scope="col">{t.offers.optionUntil}</th>
                <th scope="col">{t.common.confidence}</th>
                <th scope="col"><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {current.map((o) => {
                const low = o.confidence !== null && o.confidence < THRESHOLD && !o.verifiedBy;
                const isSel = item.selectedOfferId === o.id;
                return (
                  <tr key={o.id} className={low ? 'is-warn' : isSel ? 'is-selected' : undefined}>
                    <td><strong>{supplierName(byId, o.supplierId)}</strong>{o.negotiationRound ? <div className="muted small">{t.comparison.round} {o.negotiationRound}</div> : null}</td>
                    <td>v{o.version}<div className="muted small">{relative(o.createdAt)}</div></td>
                    <td>{t.offerSource[o.source]}</td>
                    <td className="num">{money(linesTotal(o.lines), o.currency)}</td>
                    <td className="nowrap">{date(o.optionUntil)}</td>
                    <td>{o.verifiedBy ? <Pill tone="success" icon="check">{t.offers.verified}</Pill> : <ConfidenceTag value={o.confidence} threshold={THRESHOLD} />}</td>
                    <td className="num nowrap">
                      {low ? <Button size="sm" variant="secondary" icon="alert" onClick={() => setVerifying(o)}>{t.common.verify}</Button> : null}
                      {isSel ? <Pill tone="accent" icon="check">{t.offers.selected}</Pill> : <Button size="sm" variant="ghost" onClick={() => void select(o)}>{t.offers.selectOffer}</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">{t.offers.noOffers}</p>}

      {old.length ? (
        <div>
          <button type="button" className="link-btn" onClick={() => setShowOld((x) => !x)} aria-expanded={showOld}>
            {t.publicPages.previousVersions} ({old.length})
          </button>
          {showOld ? (
            <ul className="list small">
              {old.map((o) => <li key={o.id} className="list__row"><span>{supplierName(byId, o.supplierId)} v{o.version}</span><span>{money(linesTotal(o.lines), o.currency)} · {relative(o.createdAt)}</span></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {verifying ? <VerifyOffer offer={verifying} onClose={() => setVerifying(null)} /> : null}
    </Card>
  );
}

function ParseOffer({ item, supplierOptions, onDone }: { item: ServiceItemDetail; supplierOptions: { id: string; name: string }[]; onDone: (o: SupplierOffer) => void }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const [supplierId, setSupplierId] = useState(supplierOptions[0]?.id ?? '');
  const [how, setHow] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (file?: File) => {
    if (!supplierId) return setError(t.offers.supplier);
    setBusy(true);
    setError(null);
    try {
      const o = file ? await api.items.parseOfferFile(item.id, file, supplierId) : await api.items.parseOfferText(item.id, { text, supplierId });
      await reload();
      toast(`${t.offers.parse}: ${t.common.saved}`);
      onDone(o);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="subcard stack">
      <p className="muted small">{t.offers.parseHint}</p>
      <div className="form-grid">
        <Select label={t.offers.supplier} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
          <option value="" disabled>—</option>
          {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <div className="field">
          <span className="field__label">{t.offers.source}</span>
          <Segmented label={t.offers.source} value={how} onChange={setHow} options={[{ value: 'paste', label: t.common.paste }, { value: 'file', label: t.common.upload }]} />
        </div>
      </div>
      {how === 'paste' ? (
        <>
          <TextArea label={t.common.paste} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row-end"><Button icon="sparkle" busy={busy} disabled={!text.trim() || !supplierId} onClick={() => void run()}>{t.offers.parse}</Button></div>
        </>
      ) : (
        <FilePicker label={t.common.upload} accept=".pdf,.xls,.xlsx,.csv,.eml,.png,.jpg,.jpeg,.heic" disabled={busy || !supplierId} onFile={(f) => void run(f)} />
      )}
      <InlineError message={error} />
    </div>
  );
}

function emptyOffer(item: ServiceItemDetail, supplierId: string): ManualOfferInput {
  return {
    rfqId: item.rfqs.find((r) => r.supplierId === supplierId)?.id ?? null,
    supplierId, source: 'manual', currency: 'EUR', lines: [emptyLine(item.kind, { description: item.description, quantity: item.quantity, nights: item.nights ?? undefined })],
    optionUntil: null, guaranteePax: null, attritionTerms: null, paymentTerms: null, prepaymentRate: null, cancellationTerms: null, overtimeTerms: null, notes: null,
  };
}

export function TermsFields<T extends Partial<Pick<SupplierOffer, 'optionUntil' | 'guaranteePax' | 'paymentTerms' | 'prepaymentRate' | 'cancellationTerms' | 'attritionTerms' | 'overtimeTerms' | 'notes'>>>({ v, onChange }: { v: T; onChange: (v: T) => void }) {
  const t = useT();
  return (
    <div className="form-grid">
      <TextInput label={t.offers.optionUntil} type="date" value={v.optionUntil ?? ''} onChange={(e) => onChange({ ...v, optionUntil: e.target.value || null })} />
      <TextInput label={t.offers.guaranteePax} type="number" min={0} value={v.guaranteePax ?? ''} onChange={(e) => onChange({ ...v, guaranteePax: e.target.value ? Number(e.target.value) : null })} />
      <TextInput label={t.offers.prepaymentRate} type="number" min={0} max={100} value={v.prepaymentRate !== null && v.prepaymentRate !== undefined ? Math.round(v.prepaymentRate * 100) : ''} onChange={(e) => onChange({ ...v, prepaymentRate: e.target.value ? Number(e.target.value) / 100 : null })} />
      <TextInput label={t.offers.paymentTerms} value={v.paymentTerms ?? ''} onChange={(e) => onChange({ ...v, paymentTerms: e.target.value || null })} className="span-full" />
      <TextInput label={t.offers.cancellationTerms} value={v.cancellationTerms ?? ''} onChange={(e) => onChange({ ...v, cancellationTerms: e.target.value || null })} className="span-full" />
      <TextInput label={t.offers.attritionTerms} value={v.attritionTerms ?? ''} onChange={(e) => onChange({ ...v, attritionTerms: e.target.value || null })} />
      <TextInput label={t.offers.overtimeTerms} value={v.overtimeTerms ?? ''} onChange={(e) => onChange({ ...v, overtimeTerms: e.target.value || null })} />
      <TextInput label={t.common.notes} value={v.notes ?? ''} onChange={(e) => onChange({ ...v, notes: e.target.value || null })} />
    </div>
  );
}

function ManualOffer({ item, supplierOptions, onDone }: { item: ServiceItemDetail; supplierOptions: { id: string; name: string }[]; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const [o, setO] = useState<ManualOfferInput>(() => emptyOffer(item, supplierOptions[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="subcard stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.items.addOffer(item.id, o);
          await reload();
          toast(t.common.saved);
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <Select label={t.offers.supplier} value={o.supplierId} onChange={(e) => setO({ ...o, supplierId: e.target.value, rfqId: item.rfqs.find((r) => r.supplierId === e.target.value)?.id ?? null })} required>
          <option value="" disabled>—</option>
          {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select label={t.common.currency} value={o.currency} onChange={(e) => setO({ ...o, currency: e.target.value as Currency })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>
      <OfferLinesEditor lines={o.lines} onChange={(lines) => setO({ ...o, lines })} currency={o.currency} />
      <TermsFields v={o} onChange={setO} />
      <InlineError message={error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>{t.common.cancel}</Button>
        <Button type="submit" busy={busy} disabled={!o.supplierId}>{t.common.save}</Button>
      </div>
    </form>
  );
}

/** Low-confidence human verification (§6). Corrections are learning data. */
function VerifyOffer({ offer, onClose }: { offer: SupplierOffer; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const [o, setO] = useState<SupplierOffer>(offer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="subcard stack" role="region" aria-label={t.offers.verify}>
      <Callout tone="warning" icon="alert" title={t.offers.lowConfidence}>
        {t.common.confidence}: <ConfidenceTag value={offer.confidence} threshold={THRESHOLD} />
      </Callout>
      <Select label={t.common.currency} value={o.currency} onChange={(e) => setO({ ...o, currency: e.target.value as Currency })}>
        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
      </Select>
      <OfferLinesEditor lines={o.lines} onChange={(lines) => setO({ ...o, lines })} currency={o.currency} />
      <TermsFields v={o} onChange={setO} />
      <InlineError message={error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button
          icon="check"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const { lines, currency, optionUntil, guaranteePax, paymentTerms, prepaymentRate, cancellationTerms, attritionTerms, overtimeTerms, notes } = o;
              await api.offers.verify(offer.id, { lines, currency, optionUntil, guaranteePax, paymentTerms, prepaymentRate, cancellationTerms, attritionTerms, overtimeTerms, notes });
              await reload();
              toast(t.offers.verified);
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.offers.verify}
        </Button>
      </div>
    </div>
  );
}
