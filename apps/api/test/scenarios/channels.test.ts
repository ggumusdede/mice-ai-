// Senaryolar — §7 Adım 0 / Adım 1 gelen kanallar (e-posta webhook, WhatsApp Business), §3.3 (docs/10-senaryolar.md C-xx)
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers.js';
import { makeWorld, ownerSql, scenarioSuite } from './_scenario.js';

const WA_SECRET = 'scn-meta-secret';
const S = scenarioSuite({ env: { WHATSAPP_APP_SECRET: WA_SECRET, WHATSAPP_VERIFY_TOKEN: 'scn-verify' } });
let n = 0;
const mid = () => `<scn-${Date.now()}-${n++}@mail.example.com>`;

describe('Gelen kanallar', () => {
  it('C-01 §7.0 bilinmeyen göndericiden e-posta → talep (proje kodu, insan oluşturmadı); aynı Message-ID tekrar işlenmez', async () => {
    const w = await makeWorld(S, 'c1');
    const m = { from: 'Selin Aydın <selin@yeni-musteri.example.com>', to: 'talep@acenta.example.com', subject: 'Teklif talebi', messageId: mid(),
      text: "12-14 Mart 2027 tarihlerinde Kadıköy'de 60 kişilik toplantı, 20 SGL 20 DBL oda, tiyatro düzeni. Firma: Yeni Kimya A.Ş." };
    const r = await w.inboundEmail(m);
    expect(r.body).toMatchObject({ kind: 'new_request', status: 'processed', duplicate: false });
    const p = (await w.admin.get(`/api/projects/${r.body.projectId}`)).body.project;
    expect(p.code).toMatch(/^PRJ-0001-YENI.*-20270312-60-TBD$/);
    expect((await ownerSql('SELECT created_by FROM projects WHERE id = $1', [p.id]))[0].created_by).toBeNull();
    expect((await w.inboundEmail(m)).body.duplicate).toBe(true);
  });

  it('C-02 §7.1 tedarikçi RFQ e-postasına yanıt verir → mevcut teklif okuma (yeni sürüm), RFQ "yanıtlandı"', async () => {
    const w = await makeWorld(S, 'c2');
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    const out = (await ownerSql(`SELECT o.id FROM outbox o JOIN message_drafts d ON d.id = o.draft_id WHERE d.project_id = $1 AND o.to_address = 'satis@moda.example.com'`, [p.id]))[0];
    const r = await w.inboundEmail({ from: 'satis@moda.example.com', subject: 'Re: fiyat talebi', messageId: mid(), inReplyTo: `<${out.id}@mice.local>`,
      text: 'Oda (DBL, BB): 110 EUR x 25 oda x 2 gece\nOda (SGL, BB): 95 EUR x 30 oda x 2 gece\nKDV hariç. Opsiyon: 20.01.2027' });
    expect(r.body).toMatchObject({ kind: 'supplier_reply', projectId: p.id });
    expect(r.body.offerId).toBeTruthy();
    expect((await ownerSql('SELECT status FROM rfqs WHERE id = $1', [p.rfqs.accommodation.moda]))[0].status).toBe('responded');
  });

  it('C-03 §6 müşteri e-postayla "onaylıyoruz" der → otomatik kabul YOK, sorumluya görev + kritik bildirim', async () => {
    const w = await makeWorld(S, 'c3');
    const p = await w.flow().intake(undefined, { customer: 'trusted' }).offers({ accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } }).assign().quote().send();
    const r = await w.inboundEmail({ from: `burak@marmara-tek.${w.t.domain}`, subject: `Re: [${p.code.slice(0, 8)}] teklif`, messageId: mid(), text: 'Merhaba, A seçeneğini onaylıyoruz.' });
    expect(r.body.projectId).toBe(p.id);
    expect((await p.project()).outcome).toBe('open');
    expect((await w.admin.get(`/api/quotes/${p.quote.id}`)).body.status).toBe('sent');
    expect((await p.tasks()).some((t) => t.kind.startsWith('inbound_customer'))).toBe(true);
  });

  it('C-04 §10 WhatsApp Business: bilinmeyen numaradan mesaj → talep; imzasız istek reddedilir', async () => {
    const w = await makeWorld(S, 'c4');
    const pnid = `pn${Date.now()}`;
    await w.admin.post('/api/inbound-channels', { channel: 'whatsapp', routeKey: pnid });
    const msg = { from: '905551112233', id: `wamid.${Date.now()}`, timestamp: String(Math.floor(clock.now.getTime() / 1000)), type: 'text', text: { body: 'Merhaba, Ekim 2027 Şişli 60 kişi toplantı ve 30 DBL oda için fiyat alabilir miyiz?' } };
    expect((await w.whatsapp([msg], pnid, 'yanlis-sir')).status).toBe(401);
    const r = await w.whatsapp([msg], pnid, WA_SECRET);
    expect(r.body.processed[0]).toMatchObject({ kind: 'new_request' });
    const inb = await ownerSql(`SELECT channel, project_id FROM inbound_messages WHERE tenant_id = $1 AND channel = 'whatsapp'`, [w.t.tenantId]);
    expect(inb[0].project_id).toBeTruthy();
  });
});
