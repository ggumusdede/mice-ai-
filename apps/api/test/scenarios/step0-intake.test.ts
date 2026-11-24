// Senaryolar — §7 Adım 0 Talep analizi (docs/10-senaryolar.md S0-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's0'));

describe('Adım 0 — talep analizi', () => {
  it('S0-01 §7.0 e-posta talebi: proje kodu PRJ-####-MÜŞTERİ-TARİH-KİŞİ-TESİS, kalemler, ön eşleştirme (semt önce), atama kartı yalnız yöneticide', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { fromAddress: 'selin@anadolu.example.com' });
    expect(p.code).toMatch(/^PRJ-\d{4}-ANADOLUILAC-20270312-80-TBD$/);
    expect(Object.keys(p.items).sort()).toEqual(expect.arrayContaining(['accommodation', 'fnb', 'hall', 'transfer']));
    expect(p.intake.rfqReady).toBe(true);
    expect(p.intake.preMatchedSuppliers[0].supplier.district).toBe('Kadıköy');
    expect((await w.cards({ kind: 'assignment', who: 'clerk' })).length).toBe(0);
    await p.flow().assign();
    expect((await p.project()).ownerId).toBe(w.user('clerk').id);
  });

  it('S0-02 §7.0 mükerrer: aynı müşteri + çakışan tarih uyarı; çakışmayan tarih / başka müşteri / kaybedilmiş proje uyarı vermez', async () => {
    const w = await world();
    const a = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart 2027', '10-12 Nisan 2027'));
    const dup = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart 2027', '11-13 Nisan 2027'));
    expect(dup.intake.duplicates.map((d: any) => d.projectId)).toContain(a.id);
    const later = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart 2027', '20-22 Nisan 2027'));
    expect(later.intake.duplicates.map((d: any) => d.projectId)).not.toContain(a.id);
    const other = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart 2027', '10-12 Nisan 2027').replace('Anadolu İlaç', 'Ege Otomotiv A.Ş.'));
    expect(other.intake.duplicates.map((d: any) => d.projectId)).not.toContain(a.id);
    await a.flow().lost('Müşteri vazgeçti');
    await dup.flow().lost('Mükerrer');
    const again = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart 2027', '10-12 Nisan 2027'));
    expect(again.intake.duplicates.map((d: any) => d.projectId)).not.toContain(a.id);
  });

  it('S0-03 §7.0 eksik bilgi: soru taslağı fiyat içermez, yönetici onayı gerekmez; ekip kendi adresinden gönderir', async () => {
    const w = await world();
    const p = await w.flow().intake('Merhaba, Mayıs 2027 için Sarıyer\'de 40 kişilik yönetim toplantısı düşünüyoruz.', { fromAddress: 'ik@musteri.example.com' });
    expect(p.intake.rfqReady).toBe(false);
    expect(p.intake.missingFields).toEqual(expect.arrayContaining(['roomSplit', 'hallLayout', 'budget']));
    const d = p.intake.questionDraft;
    expect(d.status).toBe('draft');
    expect((await ownerSql('SELECT requires_approval FROM message_drafts WHERE id = $1', [d.id]))[0].requires_approval).toBe(false);
    expect(d.body).not.toMatch(/EUR|TL|₺|€/);
    expect((await w.cards({ projectId: p.id })).filter((c) => c.entityId === d.id)).toHaveLength(0);
    const sent = await w.clerk.post(`/api/drafts/${d.id}/send`);
    expect(sent.body.status).toBe('sent');
    expect(w.mails.at(-1)!.from).toBe(w.user('clerk').email);
    expect(w.mails.at(-1)!.to).toBe('ik@musteri.example.com');
  });

  it('S0-04 §7.0 bütçe yok → eksik listesinde; ekip segment seçer ve akış durmaz (RFQ açılır)', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT.replace(' Bütçe kişi başı 250 EUR.', ''));
    expect(p.intake.missingFields).toContain('budget');
    await p.flow().patch({ budgetSegment: '5*' }).rfqs('accommodation', ['kalamis', 'bomonti', 'bogaz']);
    expect((await p.project()).budgetSegment).toBe('5*');
    expect(p.last.items).toHaveLength(3);
  });

  it('S0-05 §15 dil: İngilizce talep ayıklanır, soru taslağı İngilizce', async () => {
    const w = await world();
    const p = await w.flow().intake('Hello, we need a quote for a 2-day meeting in Kadikoy, Istanbul on 12-14 March 2027 for 80 people. 30 single and 25 double rooms, lunch. Company: Anadolu Ilac');
    expect((await p.project()).pax).toBe(80);
    expect(p.intake.questionDraft.language).toBe('en');
  });

  it('S0-06 §15 dil: Rusça talep ayıklanır, soru taslağı Rusça', async () => {
    const w = await world();
    const p = await w.flow().intake('Здравствуйте! Нужна конференция 12-14 марта 2027, 60 человек, 20 одноместных и 20 двухместных номеров, бюджет 15000 EUR. Компания: Марс ООО');
    const pr = await p.project();
    expect(pr.pax).toBe(60);
    expect(pr.startDate).toBe('2027-03-12');
    expect(p.intake.questionDraft.language).toBe('ru');
    expect(p.intake.questionDraft.body).toMatch(/[а-яА-Я]/);
  });

  it('S0-07 §15 sesli komut: "… proje aç" → talep kartı (kanal ses); soru → cevap', async () => {
    const w = await world();
    const r = await w.clerk.post('/api/assist/voice-command', { transcript: 'Kadıköy, 40 kişi, 12 Mart 2027, iki gün toplantı, proje aç' });
    expect(r.body.intent).toBe('create_project');
    expect(r.body.intake.project).toMatchObject({ pax: 40, district: 'Kadıköy', startDate: '2027-03-12' });
    const inb = await ownerSql('SELECT channel FROM inbound_messages WHERE project_id = $1', [r.body.intake.project.id]);
    expect(inb[0].channel).toBe('voice');
    expect((await w.clerk.post('/api/assist/voice-command', { transcript: 'Bu ay kaç teklif gönderdik?' })).body.intent).toBe('ask');
  });

  it('S0-08 §7.0 kaybedilen talep de kod alır ve ölçülür (haftalık rapor kayıp nedeni); kayıp nedeni zorunlu', async () => {
    const w = await world();
    const p = await w.flow().intake('Haziran 2027 Beşiktaş 30 kişi lansman, Firma: Deniz Holding');
    expect(p.code).toMatch(/^PRJ-\d{4}-/);
    expect((await w.clerk.post(`/api/projects/${p.id}/outcome`, { outcome: 'lost' })).body.error.code).toBe('LOST_REASON_REQUIRED');
    await p.flow().lost('Tarih uymadı');
    const rep = await w.admin.get('/api/reports/weekly');
    expect(rep.body.quotes.lostReasons).toEqual(expect.arrayContaining([{ reason: 'Tarih uymadı', count: 1 }]));
  });

  it('S0-09 §17.10 mesai sayacı: kayıt zamanından itibaren yalnız mesai saatleri (hafta sonu sayılmaz)', async () => {
    const w = await world();
    setClock('2026-11-20T16:00'); // Cuma 16:00
    const p = await w.flow().intake(REQUEST_TEXT);
    setClock('2026-11-23T10:00'); // Pazartesi 10:00 → Cuma 2 sa + Pazartesi 1 sa
    expect((await p.detail()).stepTimer).toMatchObject({ businessMinutesElapsed: 180, targetBusinessMinutes: 2 * 540 });
  });

  it('S0-10 §8 müşteri kartı eşleşmesi: bilinen müşteri adı → kart + kısa kod; bilinmeyen → isimden kod', async () => {
    const w = await world();
    const known = await w.flow().intake(REQUEST_TEXT.replace('Anadolu İlaç', 'Marmara Teknoloji A.Ş.'));
    expect((await known.project()).customerId).toBe(w.customer('trusted'));
    expect(known.code).toContain('-MARMARATEK-');
    const unknown = await w.flow().intake(REQUEST_TEXT.replace('Anadolu İlaç', 'Yıldız Enerji A.Ş.'));
    expect((await unknown.project()).customerId).toBeNull();
    expect(unknown.code).toMatch(/-YILDIZ/);
  });
});
