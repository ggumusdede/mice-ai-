// v0.5 D-2 / S-01 / S-13 / S-09 / S-15 — "Ekip ve nöbet": small sub-teams, the on-call schedule, each person's busy-deputy and
// personal-account exception, issued offline field packs (remote revoke). One primary action per card; details collapsed.
import { useState } from 'react';
import type { UserTeamSettings } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { teamApi } from '../../api/teamClient';
import { dateTime } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorBox, InlineError, Loading, Pill } from '../../components/ui';

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function TeamPage() {
  const users = useApi(() => api.users.list(), []);
  const active = (users.data ?? []).filter((u) => u.active);
  if (users.error && !users.data) return <ErrorBox error={users.error} onRetry={() => void users.reload()} />;
  if (!users.data) return <Loading />;
  return (
    <div className="stack stack--lg">
      <OnCallCard users={active} />
      <TeamsCard users={active} />
      <PeopleCard />
      <PacksCard />
    </div>
  );
}

type U = { id: string; fullName: string };

function UserSelect({ users, value, onChange, label, empty = 'Seçin' }: { users: U[]; value: string; onChange: (v: string) => void; label: string; empty?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
      </select>
    </label>
  );
}

function OnCallCard({ users }: { users: U[] }) {
  const toast = useToast();
  const shifts = useApi(() => teamApi.onCall(), []);
  const now = useApi(() => teamApi.onCallNow(), []);
  const start = new Date();
  start.setHours(18, 0, 0, 0);
  const [f, setF] = useState({ userId: '', startsAt: localInput(start), endsAt: localInput(new Date(start.getTime() + 15 * 3_600_000)), note: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Nöbet çizelgesi">
      <p className="muted small">Mesai dışında gelen mesaj kartları nöbetçiye gider; belirlenen sürede bakılmazsa vekiline, sonra yöneticiye geçer (süre: Kurallar → Ürün kararları). Hiçbir mesaj kendiliğinden gitmez.</p>
      <p><strong>Şu an nöbette:</strong> {now.data?.shift ? `${now.data.shift.userName} (${dateTime(now.data.shift.endsAt)} kadar)` : 'kimse yok'}</p>
      <div className="row-wrap">
        <UserSelect users={users} label="Kim?" value={f.userId} onChange={(userId) => setF({ ...f, userId })} />
        <label className="field"><span className="field__label">Başlangıç</span><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>
        <label className="field"><span className="field__label">Bitiş</span><input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
      </div>
      <Button icon="plus" busy={busy} disabled={!f.userId} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await teamApi.addShift({ userId: f.userId, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), note: f.note || undefined });
          toast('Nöbet eklendi');
          await Promise.all([shifts.reload(), now.reload()]);
        } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
      }}>Nöbet ekle</Button>
      <InlineError message={error} />
      {shifts.data?.length ? (
        <details className="more">
          <summary>Planlanan nöbetler ({shifts.data.length})</summary>
          <ul className="simple-list">
            {shifts.data.map((s) => (
              <li key={s.id} className="simple-item">
                <span className="simple-item__main"><span className="simple-item__title">{s.userName}</span><br /><span className="muted small">{dateTime(s.startsAt)} → {dateTime(s.endsAt)}</span></span>
                <Button size="sm" variant="ghost" icon="x" onClick={async () => { await teamApi.cancelShift(s.id); await Promise.all([shifts.reload(), now.reload()]); }}>İptal</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function TeamsCard({ users }: { users: U[] }) {
  const toast = useToast();
  const teams = useApi(() => teamApi.teams(), []);
  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <Card title="Ekipler">
      <p className="muted small">Küçük çekirdek ekipler. Teklif kalitesi hem teklifi hazırlayana hem ekibine yazılır; ekip lideri yalnız kendi ekibinin rakamlarını görür.</p>
      {teams.data?.filter((t) => t.active).length ? (
        <ul className="simple-list">
          {teams.data.filter((t) => t.active).map((t) => (
            <li key={t.id} className="simple-item">
              <span className="simple-item__main">
                <span className="simple-item__title">{t.name}</span>
                <br /><span className="muted small">Lider: {t.leaderName ?? '—'} · {t.members.map((m) => m.fullName).join(', ') || 'üye yok'}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEdit(edit === t.id ? null : t.id)}>{edit === t.id ? 'Kapat' : 'Üyeler'}</Button>
              {edit === t.id ? (
                <div className="stack-sm" style={{ flexBasis: '100%' }}>
                  {users.map((u) => {
                    const member = t.members.some((m) => m.userId === u.id);
                    return (
                      <label key={u.id} className="row">
                        <input type="checkbox" checked={member} onChange={async (e) => {
                          const ids = e.target.checked ? [...t.members.map((m) => m.userId), u.id] : t.members.map((m) => m.userId).filter((x) => x !== u.id);
                          try { await teamApi.updateTeam(t.id, { memberIds: ids }); await teams.reload(); } catch (err) { setError(errorMessage(err)); }
                        }} /> <span>{u.fullName}</span>
                      </label>
                    );
                  })}
                  <Button size="sm" variant="ghost" className="btn--danger-text" onClick={async () => { await teamApi.updateTeam(t.id, { active: false }); await teams.reload(); }}>Ekibi kapat</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Henüz ekip yok.</p>}
      <div className="row-wrap">
        <label className="field"><span className="field__label">Yeni ekip adı</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Kurumsal satış" /></label>
        <UserSelect users={users} label="Lider" value={leaderId} onChange={setLeaderId} empty="(isteğe bağlı)" />
      </div>
      <Button icon="plus" disabled={!name.trim()} onClick={async () => {
        setError(null);
        try { await teamApi.createTeam({ name, leaderId: leaderId || null }); setName(''); setLeaderId(''); toast('Ekip oluşturuldu'); await teams.reload(); } catch (e) { setError(errorMessage(e)); }
      }}>Ekip oluştur</Button>
      <InlineError message={error} />
    </Card>
  );
}

function PeopleCard() {
  const s = useApi(() => teamApi.userSettings(), []);
  const [error, setError] = useState<string | null>(null);
  const patch = async (u: UserTeamSettings, b: Parameters<typeof teamApi.patchUserSettings>[1]) => {
    setError(null);
    try { const r = await teamApi.patchUserSettings(u.userId, b); s.setData((prev) => (prev ?? []).map((x) => (x.userId === r.userId ? r : x))); } catch (e) { setError(errorMessage(e)); }
  };
  const people = (s.data ?? []).filter((u) => u.active);
  return (
    <Card title="Vekiller ve hesap istisnaları">
      <details className="more">
        <summary>Kişi bazında ayarlar ({people.length})</summary>
        <p className="muted small">Meşgul vekili: son tarihli kartlar (opsiyon, bilet, release) yanıtsız kalırsa vekile yönlenir; otomatik onay yoktur. Kişisel e-posta hesabı yalnız burada verilen istisnayla bağlanabilir.</p>
        <ul className="simple-list">
          {people.map((u) => (
            <li key={u.userId} className="simple-item">
              <span className="simple-item__main"><span className="simple-item__title">{u.fullName}</span><br /><span className="muted small">{u.email}</span></span>
              <label className="field" style={{ flex: '1 1 160px' }}>
                <span className="field__label">Vekili</span>
                <select className="input select" value={u.deputyUserId ?? ''} onChange={(e) => void patch(u, { deputyUserId: e.target.value || null })}>
                  <option value="">—</option>
                  {people.filter((x) => x.userId !== u.userId).map((x) => <option key={x.userId} value={x.userId}>{x.fullName}</option>)}
                </select>
              </label>
              <label className="row"><input type="checkbox" checked={u.personalAccountAllowed} onChange={(e) => void patch(u, { personalAccountAllowed: e.target.checked })} /> <span className="small">Kişisel hesap istisnası</span></label>
            </li>
          ))}
        </ul>
      </details>
      <InlineError message={error} />
    </Card>
  );
}

function PacksCard() {
  const packs = useApi(() => teamApi.packs(), []);
  const live = (packs.data ?? []).filter((p) => !p.revokedAt && Date.parse(p.expiresAt) > Date.now());
  return (
    <Card title="Çevrimdışı saha paketleri">
      <p className="muted small">Telefonu kaybolan kişinin paketini buradan iptal edin; cihaz internete bağlanınca paket silinir, süresi dolunca da açılmaz.</p>
      {live.length ? (
        <ul className="simple-list">
          {live.map((p) => (
            <li key={p.id} className="simple-item">
              <span className="simple-item__main"><span className="simple-item__title">{p.userName}</span> <Pill>{p.guestCount} kişi</Pill><br /><span className="muted small">{p.date} · {dateTime(p.expiresAt)} kadar</span></span>
              <Button size="sm" variant="secondary" className="btn--danger-text" onClick={async () => { await teamApi.revokePack(p.id, 'yönetici iptali'); await packs.reload(); }}>İptal et</Button>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon="shield" title="Geçerli paket yok" />}
    </Card>
  );
}
