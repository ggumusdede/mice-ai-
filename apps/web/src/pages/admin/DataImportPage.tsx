// §8 İlk veri yükü — Yönetim → Veri aktarımı: templates, upload, batch list, manual verification table, commit.
import { useState } from 'react';
import type { ImportBatchDetail, ImportEntityName, ImportRow, ImportRowStatusName } from '@mice/shared';
import { IMPORT_TEMPLATES } from '@mice/domain';
import { api, errorMessage } from '../../api/client';
import { importApi } from '../../api/dataImport';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, Checkbox, ErrorBox, InlineError, Loading, Pill, Select, TextInput, type Tone } from '../../components/ui';
import {
  ENTITY_LABEL, ENTITY_ORDER, STATUS_LABEL, approvedByEntity, commitReadiness, filterRows, groupByStatus, rowLabel,
} from '../../lib/dataImport';

const STATUS_TONE: Record<ImportRowStatusName, Tone> = { ok: 'success', warning: 'warning', error: 'danger' };
const REVIEW_LABEL = { pending: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' } as const;
const REVIEW_TONE: Record<keyof typeof REVIEW_LABEL, Tone> = { pending: 'neutral', approved: 'success', rejected: 'purple' };
const BATCH_LABEL = { open: 'Açık', committed: 'İşlendi', abandoned: 'Vazgeçildi' } as const;

export function DataImportPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const batches = useApi(() => importApi.batches(), [], { enabled: isAdmin });
  const rules = useApi(() => api.rules.get(), [], { enabled: isAdmin });
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [windowMonths, setWindowMonths] = useState<string>('');
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return <Callout tone="warning" icon="shield">Veri aktarımını yalnızca yönetici yapar.</Callout>;
  if (batches.error && !batches.data) return <ErrorBox error={batches.error} onRetry={() => void batches.reload()} />;
  if (!batches.data) return <Loading />;
  const months = rules.data?.initialImportWindowMonths ?? 18;

  return (
    <div className="stack stack--lg data-import">
      <Callout tone="accent" icon="info" title="İlk veri yükü (PRD §8)">
        Yalnızca son {months} ayda kapanmış projeler ve fiyatlar, satır satır elle doğrulanarak yüklenir. Hiçbir satır siz onaylamadan
        canlı tablolara geçmez; aktarılan projeler “geçmiş” olarak işaretlenir ve aktif listelerde, karar kutusunda, takiplerde görünmez.
      </Callout>

      <Card title="Şablonlar">
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {ENTITY_ORDER.map((e) => (
                <tr key={e}>
                  <td className="strong">{ENTITY_LABEL[e]}</td>
                  <td className="small muted">{IMPORT_TEMPLATES[e].columns.filter((c) => c.required).map((c) => c.label).join(', ')}</td>
                  <td className="num">
                    <Button size="sm" variant="ghost" icon="doc" onClick={() => void importApi.template(e, 'xlsx').catch((x) => toast(errorMessage(x), 'danger'))}>XLSX</Button>
                    <Button size="sm" variant="ghost" icon="doc" onClick={() => void importApi.template(e, 'csv').catch((x) => toast(errorMessage(x), 'danger'))}>CSV</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-end import-window">
          <TextInput label="Aktarım penceresi (ay) — kural initialImportWindowMonths" type="number" min={1} max={120}
            value={windowMonths || String(months)} onChange={(e) => setWindowMonths(e.target.value)} />
          <Button variant="secondary" disabled={!windowMonths || Number(windowMonths) === months} onClick={async () => {
            try {
              rules.setData(await api.rules.patch({ initialImportWindowMonths: Number(windowMonths) }));
              setWindowMonths('');
              toast('Pencere kuralı güncellendi; açık aktarımı “Yeniden doğrula” ile kontrol edin');
            } catch (x) { toast(errorMessage(x), 'danger'); }
          }}>Kaydet</Button>
        </div>
      </Card>

      <Card title="Aktarımlar" padded={false}>
        <div className="row-end import-new">
          <TextInput label="Yeni aktarım adı" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ör. 2025 kapanmış projeler" />
          <Button icon="plus" busy={busy} onClick={async () => {
            setBusy(true);
            try {
              const b = await importApi.create(label || undefined);
              batches.setData((p) => [b, ...(p ?? [])]);
              setSelected(b.id);
              setLabel('');
            } catch (x) { toast(errorMessage(x), 'danger'); } finally { setBusy(false); }
          }}>Yeni aktarım</Button>
        </div>
        <div className="table-wrap">
          <table className="table table--hover" aria-label="Aktarım listesi">
            <thead><tr><th>Ad</th><th>Durum</th><th className="num">Satır</th><th className="num">Hata</th><th className="num">Onaylı</th><th>Oluşturma</th></tr></thead>
            <tbody>
              {batches.data.map((b) => (
                <tr key={b.id} className={`is-clickable ${selected === b.id ? 'is-selected' : ''}`} onClick={() => setSelected(b.id)}>
                  <td><button type="button" className="link-btn strong">{b.label ?? 'Adsız aktarım'}</button></td>
                  <td><Pill tone={b.status === 'committed' ? 'success' : b.status === 'abandoned' ? 'neutral' : 'accent'}>{BATCH_LABEL[b.status]}</Pill></td>
                  <td className="num">{b.summary?.rows ?? 0}</td>
                  <td className="num">{b.summary?.error ?? 0}</td>
                  <td className="num">{b.summary?.approved ?? 0}</td>
                  <td className="small">{new Date(b.createdAt).toLocaleString('tr-TR')}</td>
                </tr>
              ))}
              {!batches.data.length ? <tr><td colSpan={6} className="muted">Henüz aktarım yok.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selected ? <BatchView key={selected} id={selected} onChanged={() => void batches.reload()} /> : null}
    </div>
  );
}

function BatchView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const res = useApi(() => importApi.get(id), [id]);
  const [entity, setEntity] = useState<ImportEntityName>('suppliers');
  const [filterEntity, setFilterEntity] = useState<ImportEntityName | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ImportRowStatusName | 'all'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!res.data) return <Loading />;
  const d = res.data;
  const open = d.batch.status === 'open';
  const ready = commitReadiness(d);
  const rows = filterRows(d.rows, { entity: filterEntity, status: filterStatus });
  const run = async (key: string, fn: () => Promise<ImportBatchDetail | void>, ok?: string) => {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      if (next) res.setData(next);
      if (ok) toast(ok);
      onChanged();
    } catch (x) { setError(errorMessage(x)); } finally { setBusy(null); }
  };
  const s = d.batch.summary;

  return (
    <Card title={`Aktarım: ${d.batch.label ?? 'Adsız'} — ${BATCH_LABEL[d.batch.status]}`} className="import-batch"
      actions={open ? <Button size="sm" variant="ghost" icon="refresh" busy={busy === 'reval'} onClick={() => void run('reval', () => importApi.revalidate(id))}>Yeniden doğrula</Button> : null}>
      <div className="stack">
        {open ? (
          <div className="row-end import-upload">
            <Select label="Dosya türü" value={entity} onChange={(e) => setEntity(e.target.value as ImportEntityName)}>
              {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e]}</option>)}
            </Select>
            <span data-testid="import-upload">
              <FileUpload disabled={busy === 'upload'} onFile={(f) => void run('upload', () => importApi.upload(id, entity, f), `${ENTITY_LABEL[entity]} yüklendi ve doğrulandı`)} />
            </span>
          </div>
        ) : null}
        {d.files.length ? (
          <p className="small muted">Dosyalar: {d.files.map((f) => `${ENTITY_LABEL[f.entity]} (${f.fileName}, ${f.rowCount} satır${f.unknownHeaders.length ? `, tanınmayan sütun: ${f.unknownHeaders.join(', ')}` : ''})`).join(' · ')}</p>
        ) : null}
        <div className="import-stats" aria-label="Özet">
          <Pill tone="success">Hatasız {s.ok ?? 0}</Pill> <Pill tone="warning">Uyarı {s.warning ?? 0}</Pill> <Pill tone="danger">Hata {s.error ?? 0}</Pill>{' '}
          <Pill>Bekleyen {ready.pending}</Pill> <Pill tone="success">Onaylı {ready.approved}</Pill> <Pill tone="purple">Reddedilen {ready.rejected}</Pill>
          {s.windowStart ? <span className="small muted"> · pencere: {s.windowStart} sonrası ({s.windowMonths} ay)</span> : null}
        </div>
        <InlineError message={error} />

        <div className="row-end import-filters">
          <Select label="Tür" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value as ImportEntityName | 'all')}>
            <option value="all">Tümü</option>
            {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e]}</option>)}
          </Select>
          <Select label="Durum" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ImportRowStatusName | 'all')}>
            <option value="all">Tümü</option>
            {(['ok', 'warning', 'error'] as const).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
          </Select>
          {open ? (
            <>
              <Button variant="secondary" icon="check" busy={busy === 'bulk-ok'} onClick={() => void run('bulk-ok', () => importApi.review(id, { action: 'approve', statuses: ['ok'], entity: filterEntity === 'all' ? undefined : filterEntity }))}>Hatasızları onayla</Button>
              <Button variant="secondary" icon="check" busy={busy === 'bulk-warn'} onClick={() => void run('bulk-warn', () => importApi.review(id, { action: 'approve', statuses: ['warning'], entity: filterEntity === 'all' ? undefined : filterEntity }))}>Uyarılıları onayla</Button>
            </>
          ) : null}
        </div>

        <div className="table-wrap">
          <table className="table import-table" aria-label="Doğrulama tablosu">
            <thead><tr><th>Tür</th><th className="num">Satır</th><th>Kayıt</th><th>Durum</th><th>Kontroller</th><th>Doğrulama</th><th /></tr></thead>
            <tbody>
              {groupByStatus(rows).map((g) => [
                <tr key={`g-${g.status}`} className="import-group"><th colSpan={7}><Pill tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]} · {g.rows.length}</Pill></th></tr>,
                ...g.rows.flatMap((r) => [
                  <tr key={r.id} data-row-id={r.id} className={`import-row import-row--${r.status}`}>
                    <td className="small">{ENTITY_LABEL[r.entity]}</td>
                    <td className="num">{r.rowNo}</td>
                    <td className="strong">{rowLabel(r)}</td>
                    <td><Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></td>
                    <td className="small">
                      {r.issues.length ? (
                        <ul className="import-issues">
                          {r.issues.map((i, n) => <li key={n} className={`import-issue import-issue--${i.severity}`}>{i.message}</li>)}
                        </ul>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>{r.committedEntityId ? <Pill tone="success">{r.committedAction === 'linked' ? 'Bağlandı' : 'Aktarıldı'}</Pill> : <Pill tone={REVIEW_TONE[r.review]}>{REVIEW_LABEL[r.review]}</Pill>}</td>
                    <td className="num nowrap">
                      {open ? (
                        <>
                          {r.status !== 'error' && r.review !== 'approved' ? <Button size="sm" variant="ghost" icon="check" aria-label={`Satır ${r.rowNo} onayla`} onClick={() => void run(r.id, () => importApi.review(id, { action: 'approve', rowIds: [r.id] }))}>Onayla</Button> : null}
                          {r.review !== 'rejected' ? <Button size="sm" variant="ghost" icon="x" aria-label={`Satır ${r.rowNo} reddet`} onClick={() => void run(r.id, () => importApi.review(id, { action: 'reject', rowIds: [r.id] }))}>Reddet</Button> : null}
                          <Button size="sm" variant="ghost" aria-label={`Satır ${r.rowNo} düzenle`} onClick={() => setEditing(editing === r.id ? null : r.id)}>Düzenle</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>,
                  editing === r.id ? (
                    <tr key={`${r.id}-edit`} className="import-edit"><td colSpan={7}>
                      <RowEditor row={r} onCancel={() => setEditing(null)} onSave={(input) => void run(r.id, async () => { const next = await importApi.editRow(r.id, input); setEditing(null); return next; }, 'Satır güncellendi ve yeniden doğrulandı')} />
                    </td></tr>
                  ) : null,
                ]),
              ])}
              {!rows.length ? <tr><td colSpan={7} className="muted">Satır yok — bir şablon dosyası yükleyin.</td></tr> : null}
            </tbody>
          </table>
        </div>

        {d.batch.status === 'committed' && d.batch.summary.committed ? (
          <Callout tone="success" icon="check" title="Aktarım işlendi">
            {Object.entries(d.batch.summary.committed).map(([e, c]) => `${ENTITY_LABEL[e as ImportEntityName]}: ${c!.created} yeni${c!.linked ? `, ${c!.linked} mevcut kayda bağlandı` : ''}`).join(' · ')}
          </Callout>
        ) : null}
        {open ? (
          <div className="import-commit">
            <p className="small">
              Aktarılacak: {Object.entries(approvedByEntity(d.rows)).map(([e, n]) => `${ENTITY_LABEL[e as ImportEntityName]} ${n}`).join(', ') || '—'}.
              {' '}Hatalı {ready.excluded} satır aktarılmaz.{ready.reason ? ` (${ready.reason})` : ''}
            </p>
            <div className="row-end">
              <Button variant="ghost" onClick={() => {
                const reason = window.prompt('Vazgeçme nedeni (isteğe bağlı)') ?? undefined;
                void run('abandon', async () => { await importApi.abandon(id, reason); await res.reload(); }, 'Aktarımdan vazgeçildi');
              }}>Vazgeç</Button>
              <Button icon="check" disabled={!ready.canCommit} busy={busy === 'commit'}
                onClick={() => void run('commit', () => importApi.commit(id), 'Onaylı satırlar canlı kayıtlara aktarıldı')}>
                Onaylı satırları aktar ({ready.approved})
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function FileUpload({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label className="btn btn--secondary file-upload">
      <input type="file" accept=".xlsx,.csv" aria-label="Dosya yükle" disabled={disabled} className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      Dosya yükle (XLSX / CSV)
    </label>
  );
}

function RowEditor({ row, onSave, onCancel }: { row: ImportRow; onSave: (input: Record<string, string | number | boolean | null>) => void; onCancel: () => void }) {
  const cols = IMPORT_TEMPLATES[row.entity].columns;
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(cols.map((c) => [c.key, row.input[c.key] == null ? '' : String(row.input[c.key])])));
  const [accredit, setAccredit] = useState(row.data.accredit === true);
  return (
    <div className="stack">
      <div className="form-grid">
        {cols.map((c) => (
          <TextInput key={c.key} label={`${c.label}${c.required ? ' *' : ''}`} hint={c.hint} value={v[c.key] ?? ''} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}
            warn={row.issues.some((i) => i.field === c.key && i.severity !== 'info')} />
        ))}
      </div>
      {row.entity === 'suppliers' ? (
        <Checkbox label="Akredite et (yönetici kararı — aktarımda karar kutusuna kaydedilir)" checked={accredit} onChange={setAccredit} />
      ) : null}
      <div className="row-end">
        <Button variant="ghost" onClick={onCancel}>Vazgeç</Button>
        <Button onClick={() => onSave({ ...v, ...(row.entity === 'suppliers' ? { accredit } : {}) })}>Kaydet ve doğrula</Button>
      </div>
    </div>
  );
}
