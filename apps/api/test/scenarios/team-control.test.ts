// Senaryolar — v0.5-A "Ekip, iletişim ve kontrol" (docs/12-v05-kararlar.md S-01, S-02, S-08…S-15, S-25, S-26, D-2, D-3;
// docs/10-senaryolar.md EK-xx). Nothing in these flows approves or sends by itself: cards are routed to people.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@mice/shared';
import { supplierSafeCode } from '@mice/domain';
import { BIO, ist, makeWorld, ownerSql, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();

async function project(w: World, owner: 'clerk' | 'ops' = 'clerk') {
  return w.flow().intake(undefined, { customer: 'trusted' }).assign(owner);
}
async function quick(w: World, projectId: string, body: Record<string, unknown>, who: 'admin' | 'clerk' | 'ops' = 'clerk') {
  return w.as[who].post(`/api/projects/${projectId}/quick-messages`, body);
}

describe('EK — Ekip, iletişim ve kontrol (v0.5-A)', () => {
  it('EK-01 S-01 hazır şablon → tek dokunuş kart; toplu onay her kartı ayrı karar + ayrı denetim izi olarak işler; Face ID kartı topluya girmez; onaydan önce hiçbir şey gitmez', async () => {
    const w = await makeWorld(S, 'ek1');
    const p = await project(w);
    const before = w.mails.length;
    const ids: string[] = [];
    for (const note of ['Salı 12:00’ye kadar dönüyoruz.', 'Yarın sabah dönüyoruz.', 'Bugün 17:00’de dönüyoruz.']) {
      const r = await quick(w, p.id, { template: 'request_received', vars: { note } });
      expect(r.status).toBe(200);
      expect(r.body.kind).toBe('outbound_message');
      ids.push(r.body.id);
    }
    expect((await quick(w, p.id, { template: 'request_received' })).body.error.code).toBe('TEMPLATE_INPUT_MISSING');
    expect(w.mails.length).toBe(before); // nothing leaves before a human approves
    const q = await w.clerk.get('/api/quick-approvals');
    expect(q.body.items.filter((c: any) => ids.includes(c.decisionId))).toHaveLength(3);
    expect(q.body.items[0].preview).toContain('Talebinizi aldık');
    // a biometric card cannot ride along in a batch
    const bioId = (await ownerSql(`INSERT INTO decisions (tenant_id, kind, badge, summary, required_role, requires_biometric, primary_action_label)
      VALUES ($1, 'payment_approval', 'critical', 'ödeme', 'admin', true, 'Face ID ile onayla') RETURNING id`, [w.t.tenantId]))[0].id;
    const b = await w.admin.post('/api/decisions/batch-approve', { ids: [...ids, bioId] });
    expect(b.status).toBe(200);
    expect(b.body.approved).toBe(3);
    expect(b.body.results.find((x: any) => x.id === bioId)).toMatchObject({ ok: false, code: 'NOT_BATCHABLE' });
    expect(w.mails.length).toBe(before + 3);
    const rows = await ownerSql(`SELECT status, decided_by FROM decisions WHERE id = ANY($1)`, [ids]);
    expect(rows.every((r) => r.status === 'approved' && r.decided_by === w.user('admin').id)).toBe(true);
    const audit = await ownerSql(`SELECT count(DISTINCT entity_id)::int AS n FROM audit_log WHERE entity = 'decisions' AND entity_id = ANY($1) AND after->>'status' = 'approved'`, [ids]);
    expect(audit[0].n).toBe(3);
    // sender = the project owner (human address), not the system
    expect(w.mails.slice(-1)[0].from).toBe(w.user('clerk').email);
  });

  it('EK-02 S-01 mesai dışı kart nöbetçiye atanır; N dakikada ele alınmazsa vekiline yükselir; hiçbir şey otomatik onaylanmaz', async () => {
    const w = await makeWorld(S, 'ek2');
    const p = await project(w);
    await w.admin.patch(`/api/team-settings/users/${w.user('ops').id}`, { deputyUserId: w.user('finance').id });
    const sh = await w.admin.post('/api/on-call', { userId: w.user('ops').id, startsAt: ist('2026-11-20T18:00').toISOString(), endsAt: ist('2026-11-21T09:00').toISOString(), note: 'Cuma gecesi' });
    expect(sh.status).toBe(200);
    expect((await w.clerk.post('/api/on-call', { userId: w.user('ops').id, startsAt: ist('2026-11-21T18:00').toISOString(), endsAt: ist('2026-11-22T09:00').toISOString() })).status).toBe(403);
    setClock('2026-11-20T23:00');
    const c = (await quick(w, p.id, { template: 'delay_notice', to: '+905321112233', vars: { note: 'Frankfurt uçağı 95 dk rötarlı.', time: '02:40' } })).body;
    const card = (await w.cards({ who: 'ops' })).find((x) => x.id === c.id);
    expect(card.assignedTo).toBe(w.user('ops').id);
    expect(card.assignedToName).toBeTruthy();
    // 9 minutes: nothing; 11 minutes: escalates to the on-call person's deputy
    await w.worker('2026-11-20T23:09');
    expect((await ownerSql('SELECT assigned_to, escalation_level FROM decisions WHERE id = $1', [c.id]))[0]).toMatchObject({ assigned_to: w.user('ops').id, escalation_level: 0 });
    const out = await w.worker('2026-11-20T23:11');
    expect(out.some((x) => x.startsWith('cards_escalated'))).toBe(true);
    const row = (await ownerSql('SELECT assigned_to, escalation_level, status FROM decisions WHERE id = $1', [c.id]))[0];
    expect(row).toMatchObject({ assigned_to: w.user('finance').id, escalation_level: 1, status: 'open' });
    // the deputy (finance role) can now handle the routed outbound card with one tap; ops no longer can
    setClock('2026-11-20T23:15');
    expect((await w.decide({ id: c.id }, 'approve', { who: 'ops' })).status).toBe(403);
    const ok = await w.decide({ id: c.id }, 'approve', { who: 'finance' });
    expect(ok.status).toBe(200);
    expect(ok.body.decision.viaDelegation).toBe(true);
  });

  it('EK-03 S-13 son tarihli kart: önce onaylayana kritik bildirim, sonra vekile yönlenir; vekil Face ID ile karar verir; otomatik onay yok', async () => {
    const w = await makeWorld(S, 'ek3');
    await w.admin.patch(`/api/team-settings/users/${w.user('admin').id}`, { deputyUserId: w.user('ops').id });
    const id = (await ownerSql(`INSERT INTO decisions (tenant_id, kind, badge, summary, detail, required_role, requires_biometric, primary_action_label, created_at, deadline_at)
      VALUES ($1, 'payment_approval', 'critical', 'Opsiyon ödemesi', '{"optionUntil":"2026-11-21"}', 'admin', true, 'Face ID ile onayla', $2, $3) RETURNING id`,
      [w.t.tenantId, ist('2026-11-20T09:00'), ist('2026-11-21T18:00')]))[0].id;
    expect((await w.cards({ who: 'ops' })).some((x) => x.id === id)).toBe(false);
    await w.worker('2026-11-20T15:00');
    let r = (await ownerSql('SELECT approver_notified_at, deputy_id, status FROM decisions WHERE id = $1', [id]))[0];
    expect(r.approver_notified_at).not.toBeNull();
    expect(r.deputy_id).toBeNull();
    const n = await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND priority = 'critical' AND user_id = $2`, [id, w.user('admin').id]);
    expect(n[0].n).toBeGreaterThan(0);
    await w.worker('2026-11-20T15:20'); // < 30 min after the notice: still with the approver
    expect((await ownerSql('SELECT deputy_id FROM decisions WHERE id = $1', [id]))[0].deputy_id).toBeNull();
    await w.worker('2026-11-20T15:45');
    r = (await ownerSql('SELECT deputy_id, status FROM decisions WHERE id = $1', [id]))[0];
    expect(r).toMatchObject({ deputy_id: w.user('ops').id, status: 'open' });
    setClock('2026-11-20T16:00');
    const c = (await w.cards({ who: 'ops' })).find((x) => x.id === id);
    expect(c.routedToDeputy).toBe(true);
    expect((await w.decide(c, 'approve', { who: 'ops', bio: false })).body.error.code).toBe('BIOMETRIC_REQUIRED');
    const ok = await w.decide(c, 'approve', { who: 'ops' });
    expect(ok.status).toBe(200);
    expect(ok.body.decision.viaDelegation).toBe(true);
  });

  it('EK-04 S-02 kurumsal WhatsApp: onaylayanın adı mesajda ve kayıtta; atanmamış sohbetten gitmez; katılımcıya mesaj varsayılan kapalı, proje bazında lojistik açılır', async () => {
    const w = await makeWorld(S, 'ek4');
    const p = await project(w);
    const c = (await quick(w, p.id, { template: 'delay_notice', to: '+905321112233', vars: { note: 'Program 30 dk kaydı.', time: '10:30' } })).body;
    const before = w.mails.length;
    expect((await w.decide({ id: c.id }, 'approve')).status).toBe(200);
    const sent = w.mails.slice(before)[0];
    expect(sent.channel).toBe('whatsapp');
    expect(sent.body).toMatch(/— .+ · Test ek4$/);
    const d = (await ownerSql(`SELECT signed_by_name, body FROM message_drafts WHERE id = $1`, [c.detail.draftId]))[0];
    expect(d.signed_by_name).toBeTruthy();
    expect(d.body).toContain(d.signed_by_name);
    // unassigned conversation: refused
    const c2 = (await quick(w, p.id, { template: 'delay_notice', to: '+905321112233', vars: { note: 'x', time: '11:00' } })).body;
    await ownerSql('UPDATE message_drafts SET from_user_id = NULL WHERE id = $1', [c2.detail.draftId]);
    const refused = await w.decide({ id: c2.id }, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CONVERSATION_UNASSIGNED');
    // participants: off by default
    expect((await w.clerk.get(`/api/projects/${p.id}/participant-messaging`)).body).toEqual({ mode: 'off', source: 'agency' });
    expect((await quick(w, p.id, { template: 'delay_notice', recipient: 'participant', to: '+905329998877', vars: { note: 'x', time: '9' } })).body.error.code).toBe('PARTICIPANT_MESSAGING_OFF');
    expect((await w.clerk.patch(`/api/projects/${p.id}/participant-messaging`, { mode: 'logistics' })).body.error.code).toBe('REASON_REQUIRED');
    expect((await w.clerk.patch(`/api/projects/${p.id}/participant-messaging`, { mode: 'logistics', reason: 'Müşteri İK müdürü 20.11 e-postayla izin verdi' })).status).toBe(200);
    expect((await quick(w, p.id, { template: 'delay_notice', recipient: 'participant', to: '+905329998877', vars: { note: 'x', time: '9' } })).status).toBe(200);
    expect((await quick(w, p.id, { template: 'request_received', recipient: 'participant', to: 'a@b.test', vars: { note: 'x' } })).body.error.code).toBe('PARTICIPANT_MESSAGING_OFF');
  });

  it('EK-05 S-08 müşteri adı gizleme istisnası: yalnız yönetici, yalnız seçilen otel, geri alınabilir', async () => {
    const w = await makeWorld(S, 'ek5');
    const p = await w.flow().intake(undefined, { customer: 'trusted' }).assign('clerk').rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    const view = async (s: string) => (await w.pub.get(`/api/public/rfq/${p.rfqTokens.accommodation[s]}`)).body.projectCode;
    expect(await view('moda')).toBe(supplierSafeCode(p.code));
    expect((await w.clerk.post(`/api/customers/${w.customer('trusted')}/disclosures`, { supplierId: w.supplier('moda'), reason: 'x' })).status).toBe(403);
    expect((await w.admin.post(`/api/customers/${w.customer('trusted')}/disclosures`, { supplierId: w.supplier('moda'), reason: ' ' })).body.error.code).toBe('REASON_REQUIRED');
    const g = await w.admin.post(`/api/customers/${w.customer('trusted')}/disclosures`, { supplierId: w.supplier('moda'), reason: 'Müşterinin kurumsal anlaşmalı oteli' });
    expect(g.status).toBe(200);
    expect(await view('moda')).toBe(p.code);
    expect(await view('kalamis')).toBe(supplierSafeCode(p.code));
    await w.admin.post(`/api/disclosures/${g.body.id}/revoke`, { reason: 'anlaşma bitti' });
    expect(await view('moda')).toBe(supplierSafeCode(p.code));
    const list = (await w.admin.get(`/api/customers/${w.customer('trusted')}/disclosures`)).body.items;
    expect(list[0]).toMatchObject({ active: false, revokedByName: expect.any(String) });
  });

  it('EK-06 S-09 kişisel hesap: kurumsal alan adı dışı posta kutusu bağlanamaz, yönetici istisna verir; kişisel WhatsApp yalnız "Projeye ilet"', async () => {
    const w = await makeWorld(S, 'ek6');
    const p = await project(w);
    await w.rules({ corporateMailDomains: ['acenta-kurumsal.com'] });
    expect((await w.clerk.get('/api/mail/oauth/google/start')).body.error.code).toBe('PERSONAL_ACCOUNT_BLOCKED');
    await w.admin.patch(`/api/team-settings/users/${w.user('clerk').id}`, { personalAccountAllowed: true });
    expect((await w.clerk.get('/api/mail/oauth/google/start')).body?.error?.code).not.toBe('PERSONAL_ACCOUNT_BLOCKED');
    const f = await w.clerk.post(`/api/projects/${p.id}/forward`, { text: 'Müşteri: yarın 2 kişi daha gelecek', source: 'whatsapp', from: '+90 532 000 00 00' });
    expect(f.status).toBe(200);
    const inbox = (await w.clerk.get(`/api/projects/${p.id}/inbound-messages`)).body.items;
    expect(JSON.stringify(inbox)).toContain('Kişisel WhatsApp');
  });

  it('EK-07 S-10 / S-11 / D-2 çalışan yalnız kendi rakamlarını görür, isimli sıralama yönetici; tahmini prim acenta ayarıyla; ekip lideri yalnız kendi ekibini görür', async () => {
    const w = await makeWorld(S, 'ek7');
    await project(w);
    const me = await w.clerk.get('/api/me/performance');
    expect(me.status).toBe(200);
    expect(me.body.row.userId).toBe(w.user('clerk').id);
    expect(me.body.row.fullName).toBeUndefined();
    expect(me.body.estimatedBonus).toBeNull();
    expect(me.body.note).toContain('otomatik yaptırım dayanağı değildir');
    expect((await w.clerk.get('/api/reports/team-performance')).status).toBe(403);
    expect((await w.clerk.get('/api/reports/my-team-performance')).body.error.code).toBe('NOT_TEAM_LEADER');
    const t = await w.admin.post('/api/teams', { name: 'Kurumsal satış', leaderId: w.user('clerk').id, memberIds: [w.user('ops').id] });
    expect(t.body.members.map((m: any) => m.userId).sort()).toEqual([w.user('clerk').id, w.user('ops').id].sort());
    const lead = await w.clerk.get('/api/reports/my-team-performance');
    expect(lead.status).toBe(200);
    expect(lead.body.rows.map((r: any) => r.userId).sort()).toEqual([w.user('clerk').id, w.user('ops').id].sort());
    const adm = await w.admin.get('/api/reports/team-performance');
    expect(adm.body.teams[0]).toMatchObject({ name: 'Kurumsal satış', memberCount: 2 });
    expect(adm.body.userTeams[w.user('clerk').id]).toBe(t.body.id);
    await w.rules({ showEstimatedBonus: true });
    const me2 = await w.clerk.get('/api/me/performance');
    expect(me2.body.estimatedBonus).toMatchObject({ basis: 'realized_profit', rate: 0.05, onlyCollected: true });
    expect(me2.body.estimatedBonus.explanation).toContain('finans onayıyla');
    expect(me2.body.teamName).toBe('Kurumsal satış');
  });

  it('EK-08 S-12 tedarikçiye söz tutma acenta / proje düzeyinde; saha göremez', async () => {
    const w = await makeWorld(S, 'ek8');
    const p = await project(w);
    await ownerSql(`INSERT INTO decisions (tenant_id, project_id, kind, badge, summary, detail, required_role, primary_action_label, status, decided_at)
      VALUES ($1, $2, 'outbound_message', 'critical', 'opsiyon', '{"optionUntil":"2026-11-10"}', 'admin', 'x', 'approved', '2026-11-09T10:00:00Z'),
             ($1, $2, 'outbound_message', 'critical', 'opsiyon', '{"optionUntil":"2026-11-12"}', 'admin', 'x', 'open', NULL)`, [w.t.tenantId, p.id]);
    const r = await w.clerk.get('/api/reports/promise-keeping');
    expect(r.body.agency).toMatchObject({ optionsDue: 2, optionsHandled: 1, score: 50 });
    expect(r.body.projects[0]).toMatchObject({ projectId: p.id, score: 50 });
    expect(JSON.stringify(r.body)).not.toContain(w.user('clerk').id);
    expect((await w.field.get('/api/reports/promise-keeping')).status).toBe(403);
  });

  it('EK-09 S-14 bildirim varsayılanı "her zaman"; sessiz saat açılınca rutin özet pencere bitene kadar bekler', async () => {
    const w = await makeWorld(S, 'ek9');
    expect((await w.clerk.get('/api/me/preferences')).body).toMatchObject({ quietHours: null, agencyQuietHours: { enabled: false } });
    await w.clerk.patch('/api/me/preferences', { quietHours: { enabled: true, start: '08:00', end: '09:00' } });
    await ownerSql(`INSERT INTO notifications (tenant_id, user_id, priority, title, status, deliver_after) VALUES ($1, $2, 'routine', 'rutin', 'pending', $3), ($1, $4, 'routine', 'rutin', 'pending', $3)`,
      [w.t.tenantId, w.user('clerk').id, ist('2026-11-23T08:30'), w.user('ops').id]);
    await w.worker('2026-11-23T08:45');
    const st = async (k: 'clerk' | 'ops') => (await ownerSql(`SELECT status FROM notifications WHERE user_id = $1 AND title = 'rutin'`, [w.user(k).id]))[0].status;
    expect(await st('clerk')).toBe('pending');
    expect(await st('ops')).toBe('batched');
    await w.worker('2026-11-23T09:05');
    expect(await st('clerk')).toBe('batched');
  });

  it('EK-10 K-05 devir-teslim: acil kapatma Face ID + gerekçe ister; paket veriden; erişim kapanır; devralan her projeyi "okudum" der', async () => {
    const w = await makeWorld(S, 'ek10');
    const p1 = await project(w);
    const p2 = await project(w);
    await w.admin.patch(`/api/customers/${w.customer('trusted')}/relationship`, { ownerId: w.user('clerk').id, backupId: w.user('admin').id });
    expect((await w.admin.patch(`/api/customers/${w.customer('new')}/relationship`, { ownerId: w.user('ops').id, backupId: w.user('ops').id })).body.error.code).toBe('BACKUP_SAME_AS_OWNER');
    const rel = (await w.admin.get('/api/customer-relationships')).body.items;
    expect(rel.find((r: any) => r.customerId === w.customer('new')).missingBackup).toBe(true);
    const body = { fromUserId: w.user('clerk').id, toUserId: w.user('ops').id, mode: 'urgent', reason: 'İşten ayrıldı' };
    expect((await w.admin.post('/api/handovers', body)).body.error.code).toBe('BIOMETRIC_REQUIRED');
    const h = await w.admin.post('/api/handovers', { ...body, biometric: BIO });
    expect(h.status).toBe(200);
    expect(h.body.status).toBe('access_closed');
    expect(h.body.package.projects.map((x: any) => x.id).sort()).toEqual([p1.id, p2.id].sort());
    expect(h.body.package.customers[0]).toMatchObject({ name: expect.stringContaining('Marmara'), role: 'owner' });
    expect((await w.clerk.get('/api/me/performance')).status).toBe(401); // sessions revoked
    expect((await ownerSql('SELECT owner_id FROM projects WHERE id = $1', [p1.id]))[0].owner_id).toBe(w.user('ops').id);
    expect((await ownerSql('SELECT relationship_owner_id FROM customers WHERE id = $1', [w.customer('trusted')]))[0].relationship_owner_id).toBe(w.user('ops').id);
    expect((await w.admin.post(`/api/handovers/${h.body.id}/read`, { projectId: p1.id })).body.error.code).toBe('NOT_RECIPIENT');
    await w.ops.post(`/api/handovers/${h.body.id}/read`, { projectId: p1.id });
    const done = await w.ops.post(`/api/handovers/${h.body.id}/read`, { projectId: p2.id });
    expect(done.body).toMatchObject({ readPct: 100, status: 'completed' });
    expect((await w.ops.get('/api/handovers')).body.items).toHaveLength(1);
    expect((await w.finance.get(`/api/handovers/${h.body.id}`)).status).toBe(403);
  });

  it('EK-11 K-05 planlı devir: erişim zamanında (worker) kapanır, önce iptal edilebilir', async () => {
    const w = await makeWorld(S, 'ek11');
    await project(w, 'ops');
    const h = await w.admin.post('/api/handovers', { fromUserId: w.user('ops').id, toUserId: w.user('clerk').id, mode: 'planned', reason: 'İhbar süresi', effectiveAt: ist('2026-11-27T18:00').toISOString() });
    expect(h.body.status).toBe('scheduled');
    expect((await w.ops.get('/api/me/performance')).status).toBe(200);
    expect((await w.admin.post(`/api/handovers/${h.body.id}/cancel`)).body.status).toBe('cancelled');
    const h2 = await w.admin.post('/api/handovers', { fromUserId: w.user('ops').id, toUserId: w.user('clerk').id, mode: 'planned', reason: 'İhbar süresi', effectiveAt: ist('2026-11-27T18:00').toISOString() });
    const out = await w.worker('2026-11-27T18:05');
    expect(out).toContain('handover_access_closed:1');
    expect((await ownerSql('SELECT active FROM users WHERE id = $1', [w.user('ops').id]))[0].active).toBe(false);
    expect((await w.admin.post(`/api/handovers/${h2.body.id}/cancel`)).body.error.code).toBe('HANDOVER_NOT_CANCELLABLE');
  });

  it('EK-12 S-15 çevrimdışı saha paketi: yalnız ad + oda + grup + telefon, hostes yalnız kendi grubu, uzaktan iptal ve süre sonu', async () => {
    const w = await makeWorld(S, 'ek12');
    const p = await project(w);
    await ownerSql(`UPDATE projects SET outcome = 'won', start_date = '2026-11-20', end_date = '2026-11-22' WHERE id = $1`, [p.id]);
    const g = await w.ops.post(`/api/projects/${p.id}/guests`, [
      { fullName: 'Zeynep Ak', email: 'z@x.test', phone: '+905321110000', roomType: 'DBL' },
      { fullName: 'Ali Can', email: 'a@x.test', phone: '+905321110001', roomType: 'SGL' },
    ]);
    expect(g.status).toBe(200);
    const [g1, g2] = g.body.items;
    await w.ops.patch(`/api/guests/${g1.id}/field-info`, { roomNo: '204', transferGroup: 'Otobüs 1' });
    await w.ops.patch(`/api/guests/${g2.id}/field-info`, { roomNo: '101', transferGroup: 'Otobüs 2' });
    expect((await w.field.patch(`/api/guests/${g1.id}/field-info`, { roomNo: '1' })).status).toBe(403);
    await w.ops.put(`/api/projects/${p.id}/field-staff`, { userId: w.user('field').id, transferGroup: 'Otobüs 1' });
    const pk = await w.field.post('/api/field/packs', {});
    expect(pk.status).toBe(200);
    expect(Buffer.from(pk.body.key, 'base64')).toHaveLength(32);
    const guests = pk.body.pack.projects.find((x: any) => x.id === p.id).guests;
    expect(guests).toEqual([{ name: 'Zeynep Ak', room: '204', group: 'Otobüs 1', phone: '+905321110000' }]);
    expect(JSON.stringify(pk.body)).not.toContain('z@x.test');
    const stored = (await ownerSql('SELECT key_hash FROM field_packs WHERE id = $1', [pk.body.pack.packId]))[0];
    expect(stored.key_hash).not.toContain(pk.body.key);
    expect((await w.field.get(`/api/field/packs/${pk.body.pack.packId}/status`)).body).toMatchObject({ valid: true, reason: 'ok' });
    expect((await w.finance.post('/api/field/packs', {})).status).toBe(403);
    // ops (no group restriction) sees both
    expect((await w.ops.post('/api/field/packs', {})).body.pack.projects.find((x: any) => x.id === p.id).guests).toHaveLength(2);
    expect((await w.admin.post(`/api/field/packs/${pk.body.pack.packId}/revoke`, { reason: 'telefon kayboldu' })).body.revokedAt).toBeTruthy();
    expect((await w.field.get(`/api/field/packs/${pk.body.pack.packId}/status`)).body).toMatchObject({ valid: false, reason: 'revoked' });
    const pk2 = await w.field.post('/api/field/packs', {});
    setClock('2026-11-21T13:00'); // 36 h after the start of the pack day
    expect((await w.field.get(`/api/field/packs/${pk2.body.pack.packId}/status`)).body).toMatchObject({ valid: false, reason: 'expired' });
    await w.rules({ fieldPackEnabled: false });
    expect((await w.field.post('/api/field/packs', {})).body.error.code).toBe('FIELD_PACK_DISABLED');
  });

  it('EK-13 D-3 ilk yüklemede "Satış sorumlusu": e-posta / adla kullanıcıya eşleşir, eşleşmeyen uyarı; geçmiş proje ekip performansında sayılır', async () => {
    const w = await makeWorld(S, 'ek13');
    const b = (await w.admin.post('/api/import/batches', { label: 'satış sorumlusu' })).body.id;
    const csv = 'Proje kodu;Başlık;Müşteri;Başlangıç;Bitiş;Kişi;Sonuç;Kayıp nedeni;Satış sorumlusu\n'
      + `2026-501;Bayi toplantısı;Marmara Teknoloji A.Ş.;10.03.2026;12.03.2026;80;kazanıldı;;${w.user('clerk').email}\n`
      + '2026-502;Lansman;Marmara Teknoloji A.Ş.;15.04.2026;15.04.2026;90;kaybedildi;Fiyat;Mehmet Yok\n';
    const up = await w.admin.post(`/api/import/batches/${b}/files`, { entity: 'projects', fileName: 'projects.csv', csv });
    expect(up.status).toBe(200);
    const d = (await w.admin.get(`/api/import/batches/${b}`)).body;
    const rows = d.rows.filter((r: any) => r.entity === 'projects');
    expect(rows.find((r: any) => r.data.code === '2026-501').issues.some((i: any) => i.code.startsWith('SALES_OWNER'))).toBe(false);
    expect(rows.find((r: any) => r.data.code === '2026-502').issues.map((i: any) => i.code)).toContain('SALES_OWNER_NOT_FOUND');
    await w.admin.post(`/api/import/batches/${b}/review`, { action: 'approve', statuses: ['ok', 'warning'] });
    expect((await w.admin.post(`/api/import/batches/${b}/commit`)).status).toBe(200);
    const owners = await ownerSql(`SELECT source_ref, owner_id FROM projects WHERE historical AND tenant_id = $1 ORDER BY source_ref`, [w.t.tenantId]);
    expect(owners.map((o) => o.owner_id)).toEqual([w.user('clerk').id, null]);
    const tp = await w.admin.get('/api/reports/team-performance');
    expect(tp.body.rows.find((r: any) => r.userId === w.user('clerk').id).historicalProjects).toBeGreaterThanOrEqual(1);
  });

  it('EK-14 S-25 / S-26 ses varsayılan kapalı; 17 temkinli varsayılan kural olarak gelir ve yönetici değiştirir', async () => {
    const w = await makeWorld(S, 'ek14');
    const r = (await w.field.get('/api/rules')).body;
    expect(r.voiceFeaturesEnabled).toBe(false);
    for (const k of ['negotiationUseHotelOwnPublicPrice', 'rfqShowBudget', 'supplierQualitativeSummary', 'supplierPagePoweredBy', 'crisisDeputyUserId',
      'crisisSpendCapTry', 'roomingChangeMode', 'postEventReportBusinessDays', 'participantMessagingDefault', 'participantPreferencesRequireConsent',
      'departedMailboxRetentionDays', 'officeSupportRoleEnabled', 'fieldAdvanceSelfViewOnly', 'cashWeightedProfitSeparate', 'billingModelRequiresApproval',
      'visaInsuranceTrackingOnly', 'leakScanGuaranteeDesignPartnersOnly', 'departedAgencyReadOnlyDays'] as const) {
      expect(r[k]).toEqual(DEFAULT_RULES[k]);
    }
    expect(r.postEventReportBusinessDays).toBe(3);
    expect(r.participantMessagingDefault).toBe('off');
    expect((await w.clerk.patch('/api/rules', { voiceFeaturesEnabled: true })).status).toBe(403);
    await w.rules({ voiceFeaturesEnabled: true });
    expect((await w.field.get('/api/rules')).body.voiceFeaturesEnabled).toBe(true);
  });
});
