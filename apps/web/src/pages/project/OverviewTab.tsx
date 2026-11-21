import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { eur, pct, signedPct } from '../../lib/format';
import { Button, Callout, Card, EmptyState, InlineError, KeyValues, MarginMarkup, Pill, PriceClassPill, TextArea, TextInput } from '../../components/ui';
import { useProject } from './ProjectContext';
import { unitLabel } from '../../components/OfferLinesEditor';
import { supplierName, useSuppliers } from './useSuppliers';

export function OverviewTab() {
  const t = useT();
  const { detail } = useProject();
  const { byId } = useSuppliers();
  const items = detail.items;
  const accommodation = items.filter((i) => i.kind === 'accommodation');

  return (
    <div className="stack stack--lg">
      <ProjectInfoCard />
      <Card title={t.project.items} padded={false}>
        {items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.items.kind}</th>
                  <th scope="col">{t.items.description}</th>
                  <th scope="col">{t.project.supplier}</th>
                  <th scope="col" className="num">{t.project.offerCount}</th>
                  <th scope="col" className="num">{t.project.cost}</th>
                  <th scope="col" className="num">{t.project.sale}</th>
                  <th scope="col">{t.profit.marginShort} / {t.profit.markupShort}</th>
                  <th scope="col">{t.project.evaluation}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{t.serviceKind[i.kind]}{i.valueAdd ? <div><Pill tone="purple">Katma değer</Pill></div> : null}</td>
                    <td>{i.description}<div className="muted small">{i.quantity} {unitLabel(i.unit)}{i.nights ? ` · ${i.nights} gece` : ''}</div></td>
                    <td>{i.selectedSupplierName ?? <span className="muted">—</span>}</td>
                    <td className="num">{i.offers.filter((o) => !o.supersededBy).length}</td>
                    <td className="num">{eur(i.costEur)}</td>
                    <td className="num">{eur(i.saleEur)}</td>
                    <td>{i.costEur !== null && i.saleEur !== null ? <MarginMarkup cost={i.costEur} sale={i.saleEur} /> : <span className="muted">—</span>}</td>
                    <td><PriceClassPill value={i.priceClass} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="folder" title={t.project.noItems} action={<Link className="btn btn--secondary" to={`/projeler/${detail.project.id}/items`}>{t.project.addItem}</Link>} />
        )}
      </Card>

      {accommodation.map((item) => {
        const evals = item.evaluations;
        if (!evals.length) return null;
        return (
          <Card key={item.id} title={`${t.project.accommodationCompare} — ${item.description}`} padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t.offers.supplier}</th>
                    <th scope="col" className="num">{t.project.netPrice}</th>
                    <th scope="col" className="num">{t.project.channelPrice}</th>
                    <th scope="col" className="num">{t.project.advantage}</th>
                    <th scope="col">{t.comparison.suggestedMarkup}</th>
                    <th scope="col">{t.project.risks}</th>
                    <th scope="col">{t.project.evaluation}</th>
                  </tr>
                </thead>
                <tbody>
                  {evals.map((e) => {
                    const offer = item.offers.find((o) => o.id === e.offerId);
                    const selected = item.selectedOfferId === e.offerId;
                    return (
                      <tr key={e.offerId} className={selected ? 'is-selected' : undefined}>
                        <td>
                          <strong>{supplierName(byId, e.normalized.supplierId ?? offer?.supplierId)}</strong>
                          {e.candidateSupplier ? <div><Pill tone="warning" icon="alert">{t.project.candidateSupplier}</Pill></div> : null}
                          {selected ? <div><Pill tone="accent" icon="check">{t.offers.selected}</Pill></div> : null}
                        </td>
                        <td className="num">{eur(e.normalized.perRoomNightEur ?? e.normalized.totalNetExVatEur)}</td>
                        <td className="num">{e.benchmark.type === 'channel' ? eur(e.benchmark.value) : <span className="muted">{t.comparison.benchmarkType[e.benchmark.type]}</span>}</td>
                        <td className={`num ${e.advantage !== null && e.advantage > 0 ? 'text-success' : e.advantage !== null && e.advantage < 0 ? 'text-danger' : ''}`}>{signedPct(e.advantage)}</td>
                        <td>{e.suggestedMarkup !== null ? <span className="mm"><span><span className="mm__k">{t.profit.markupShort}</span> {pct(e.suggestedMarkup)}</span><span><span className="mm__k">{t.profit.marginShort}</span> {pct(e.suggestedMarkup / (1 + e.suggestedMarkup))}</span></span> : '—'}</td>
                        <td className="col-notes">{e.risks.length || e.normalized.hiddenCosts.length ? (
                          <ul className="bullets small">
                            {e.normalized.hiddenCosts.map((h, k) => <li key={`h${k}`} className={h.severity === 'critical' ? 'text-danger' : h.severity === 'warning' ? 'text-warning' : ''}>{h.description}</li>)}
                            {/* risks repeat the hidden-cost descriptions; show only the extra ones */}
                            {[...new Set(e.risks)].filter((r) => !e.normalized.hiddenCosts.some((h) => h.description === r)).map((r, k) => <li key={`r${k}`}>{r}</li>)}
                          </ul>
                        ) : <span className="muted">—</span>}</td>
                        <td><PriceClassPill value={e.priceClass} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Editable project facts that documents depend on: billing info (contract / customer invoice) and venue (code's venue segment). */
function ProjectInfoCard() {
  const t = useT();
  const toast = useToast();
  const { detail, reload } = useProject();
  const p = detail.project;
  const billing = p.billingInfo ?? detail.customer?.billingAddress ?? null;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ billingInfo: p.billingInfo ?? '', venueName: p.venueName ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, string | null> = {};
      if (f.billingInfo.trim() !== (p.billingInfo ?? '')) patch.billingInfo = f.billingInfo.trim() || null;
      if (f.venueName.trim() !== (p.venueName ?? '')) patch.venueName = f.venueName.trim() || null;
      if (Object.keys(patch).length) await api.projects.patch(p.id, patch);
      await reload();
      setEditing(false);
      toast(t.common.saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={t.project.info}
      className="proj-info"
      actions={!editing ? <Button size="sm" variant="secondary" icon="doc" onClick={() => { setF({ billingInfo: p.billingInfo ?? '', venueName: p.venueName ?? '' }); setEditing(true); }}>{t.common.edit}</Button> : null}
    >
      {editing ? (
        <div className="stack">
          <TextArea label={t.project.billingInfo} rows={3} placeholder={t.project.billingPlaceholder} value={f.billingInfo} onChange={(e) => setF({ ...f, billingInfo: e.target.value })} />
          <TextInput label={t.project.venue} hint={t.project.venueHint} value={f.venueName} onChange={(e) => setF({ ...f, venueName: e.target.value })} />
          <InlineError message={error} />
          <div className="row-end">
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{t.common.cancel}</Button>
            <Button busy={busy} onClick={() => void save()}>{t.common.save}</Button>
          </div>
        </div>
      ) : (
        <>
          <KeyValues rows={[
            { k: t.projects.code, v: <span className="mono">{p.code}</span> },
            { k: t.project.venue, v: p.venueName ?? <span className="muted">—</span> },
            { k: t.project.billingInfo, v: billing ?? <span className="muted">—</span>, warn: !billing },
          ]} />
          {!billing ? <Callout tone="warning" icon="alert">{t.project.billingMissing}</Callout> : null}
        </>
      )}
    </Card>
  );
}
