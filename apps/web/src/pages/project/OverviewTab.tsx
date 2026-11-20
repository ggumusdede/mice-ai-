import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { eur, pct, signedPct } from '../../lib/format';
import { Card, EmptyState, MarginMarkup, Pill, PriceClassPill } from '../../components/ui';
import { useProject } from './ProjectContext';
import { supplierName, useSuppliers } from './useSuppliers';

export function OverviewTab() {
  const t = useT();
  const { detail } = useProject();
  const { byId } = useSuppliers();
  const items = detail.items;
  const accommodation = items.filter((i) => i.kind === 'accommodation');

  return (
    <div className="stack stack--lg">
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
                    <td>{i.description}<div className="muted small">{i.quantity} {i.unit}{i.nights ? ` · ${i.nights} gece` : ''}</div></td>
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
                        <td>{e.risks.length || e.normalized.hiddenCosts.length ? (
                          <ul className="bullets small">
                            {e.risks.map((r, k) => <li key={`r${k}`}>{r}</li>)}
                            {e.normalized.hiddenCosts.map((h, k) => <li key={`h${k}`} className={h.severity === 'critical' ? 'text-danger' : h.severity === 'warning' ? 'text-warning' : ''}>{h.description}</li>)}
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
