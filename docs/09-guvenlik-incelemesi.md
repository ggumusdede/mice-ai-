# 09 — Güvenlik incelemesi

**Kapsam:** `apps/api` (Fastify 5 + PostgreSQL 16 RLS), `apps/web` (React SPA, public token sayfaları), `packages/ai`,
`packages/domain`. İnceleme **koddan** yapıldı (dokümandan değil). Bulgular okunarak doğrulandı; düzeltilen her bulgu için
regresyon testi var (`apps/api/test/security-review.test.ts`, kimlik `G-xx`). G-01 ve G-07 testleri düzeltme geri alınınca
kırmızıya döndüğü ayrıca doğrulandı.

**Ölçüt:** PRD §3.6 (silinmez denetim), §3.8 (çok kiracılı), §6 (AI yasak listesi), §15 (para / sözleşme onayında biyometri),
§17.1 (rol yetkileri, vekâlet), §17.9 (KVKK), §18.10 (tedarikçi linki güvenliği).

## Özet

| ID | Önem | Bulgu | Durum |
|---|---|---|---|
| G-01 | **Yüksek** | Onaylanmış dış mesaj taslağı sonradan değiştirilip onaysız gönderilebiliyordu; onay bekleyen taslak kart görüntüsünden farklı içerikle onaylanabiliyordu; alıcı / konu üzerinden başlık enjeksiyonu | Düzeltildi |
| G-02 | **Yüksek** | Yalnız oturum belirteci (JWT) ile yeni WebAuthn cihazı kaydedilebiliyordu → çalınan oturum Face ID adım doğrulamasını aşar. Web istemcisi kayıt gövdesini yanlış gönderiyordu (kayıt hiç çalışmıyordu) | Düzeltildi |
| G-03 | Orta | Girişte hız sınırı yok (kaba kuvvet / credential stuffing); bilinmeyen e-postada yanıt süresi farkı (kullanıcı keşfi) | Düzeltildi |
| G-04 | Orta | Yapılandırma "açık" başarısız oluyordu: `NODE_ENV` boş / yanlış yazılmışsa (`prod`, `staging`) herkesçe bilinen geliştirme JWT sırrı, misafir anahtarı ve dev biyometri atlaması etkin | Düzeltildi |
| G-05 | Orta | Vekil, kendi oluşturduğu ödeme talebini / kendi girdiği limit üstü saha ekstrasını onaylayabiliyordu (dört göz ilkesi, §17.1 "Finance … onaylamaz") | Düzeltildi |
| G-06 | Orta | KVKK: rıza bildirimi e-postasıyla misafirin adı ve e-postası `outbox`'ta açık metin ve **silinemez `audit_log`'da** kalıyordu; anonimleştirme bunlara ulaşmıyordu | Düzeltildi |
| G-07 | Orta | Public RFQ dosya yükleme: 20 MB'a kadar gövde token doğrulanmadan **ve** DB işlemi (havuzda 10 bağlantı) açıkken okunuyordu → kimliksiz DoS | Düzeltildi |
| G-08 | Düşük | Banka ekstresi satır sınırı yok: tek işlemde sınırsız satır × eşleştirme sorgusu | Düzeltildi |
| G-09 | Düşük | Anket eşzamanlı çift gönderimde ikisi de kabul ediliyordu (yarış) | Düzeltildi |
| G-10 | Düşük | Banka hareketleri ve komisyon listesi her rolde (satış, saha) okunabiliyordu | Düzeltildi |
| G-11 | Düşük | Askıya alınmış acenta: giriş, mevcut JWT'ler ve public linkler çalışmaya devam ediyordu | Düzeltildi |
| G-12 | Düşük | Güvenlik başlıkları yok (nosniff, frame, referrer, CSP); token içeren URL'ler önbelleğe / Referer'a düşebilir | Düzeltildi |
| G-14 | **Yüksek** | Yabancı anahtarlar yalnız `id`'ye bağlıydı; FK kontrolü RLS'yi atlar → B acentası, A'nın UUID'sini bilerek A'nın tedarikçisine / projesine / RFQ'suna işaret eden satır yazabiliyordu (kiracı bütünlüğü, §3.8) | Düzeltildi |
| G-13 | Düşük | Public rooming formu sınırsız misafir kabul ediyordu → sızan link acentanın adresinden sınırsız e-posta (spam / oltalama rölesi, §18.10) | Düzeltildi |

## Bulgular

### G-01 — Onay sonrası taslak değişikliği / başlık enjeksiyonu (Yüksek)
- **Yer:** `apps/api/src/services/drafts.ts` (`editDraft`, `sendDraft`). `PATCH /api/drafts/:id`, `requires_approval` ve
  `approved` durumundaki taslağın gövdesini / alıcısını değiştiriyor, durumu `approved` bırakıyordu; `POST /api/drafts/:id/send`
  bu durumda kontrolsüz gönderiyordu (§3.3, §6 "insan onayı olmadan dışarıya mesaj"). `pending_approval` iken düzenleme, kartın
  gösterdiği anlık görüntüden farklı metnin onaylanmasına yol açıyordu (TOCTOU). `to` / `subject` CR/LF içerebiliyordu
  (SMTP sağlayıcısıyla `Bcc:` enjeksiyonu).
- **Düzeltme:** onay bekleyen taslak yalnız karar kartındaki "Düzelt" ile değişir (`DRAFT_PENDING_APPROVAL`, 409); onaylı taslakta
  içerik veya dolu alıcı değişirse onay düşer (`status='draft'`, yeniden onay gerekir); boş alıcının sonradan girilmesi onayı
  bozmaz. `assertNoHeaderBreak` hem düzenlemede hem gönderimde CR/LF'yi reddeder (`INVALID_HEADER_VALUE`).
- **Test:** `G-01 …`. `closing-admin.test.ts` haftalık rapor testi artık düz taslağı düzeltir (onay bekleyen taslak dondurulmuş).

### G-02 — WebAuthn kaydı yalnız JWT ile (Yüksek)
- **Yer:** `apps/api/src/routes/auth.ts`, `apps/web/src/lib/webauthn.ts`, `apps/web/src/api/client.ts`, `AppShell.tsx`.
  `POST /api/auth/webauthn/register/options|verify` yalnız geçerli oturum istiyordu; belirteci ele geçiren (XSS, cihaz, log)
  kendi authenticator'ını kaydedip ödeme / sözleşme kararlarında "Face ID"yi geçebilirdi. Ayrıca web, `verify` için yanıtı
  `{response}` sarmadan gönderiyordu → sunucu iç `response` alanını okuyup kaydı reddediyordu.
- **Düzeltme:** kayıt seçenekleri şifre yeniden doğrulaması ister (`{password}`; yanlışsa 403 `REAUTH_FAILED`). Web profil
  sayfasına şifre alanı eklendi; `verify` gövdesi `{response, deviceLabel}`.
- **Test:** `offers.test.ts` (şifresiz 400, yanlış şifre 403, doğru şifre seçenek döner).

### G-03 — Giriş kaba kuvvet / kullanıcı keşfi (Orta)
- **Yer:** `routes/auth.ts`. **Düzeltme:** `@fastify/rate-limit` yalnız giriş rotasında, IP başına dakikada `LOGIN_RATE_LIMIT`
  (varsayılan 20) → 429. Bilinmeyen e-postada da bir scrypt doğrulaması çalışır (sabit süre).
- **Test:** `G-03 …` (limit 3 → 4. deneme 429).

### G-04 — Yapılandırma açık başarısızlık (Orta)
- **Yer:** `apps/api/src/config.ts`. Kontrol yalnız `NODE_ENV==='production'` içindi; varsayılan `development`.
- **Düzeltme:** geliştirme varsayılanları yalnız `NODE_ENV` açıkça `development` / `test` iken; diğer her değerde `JWT_SECRET`
  (≥ 32 karakter) ve `GUEST_DATA_KEY` zorunlu, dev biyometri kapalı (`ALLOW_DEV_BIOMETRIC=1` bilinçli demo istisnası olarak kaldı).
- **Test:** `G-04 …`.

### G-05 — Vekilin kendi talebini onaylaması (Orta)
- **Yer:** `services/finance.ts` (`paymentDecisionEffect`), `services/phase-b-registry.ts` (`field_extra`). `canDecide` vekile
  ödeme onayı veriyor (doğru, §17.1) ama talebi açan finans kullanıcısı vekil olunca kendi talebini onaylayabiliyordu.
- **Düzeltme:** yönetici dışındaki karar veren, talebi açan / ekstrayı giren kişiyse 403 `SELF_APPROVAL_FORBIDDEN`. Yönetici
  istisnası bilinçli (tek yöneticili butik acenta kilitlenmesin).
- **Test:** `G-05 …`.

### G-06 — KVKK: misafir verisinin açık kopyaları (Orta)
- **Yer:** `services/guests.ts` (rıza e-postası), `audit_row()` tetikleyicisi. `outbox.body` "Merhaba <ad>" ve `to_address`
  misafir e-postasını tutuyordu; `outbox` denetlendiği için ikisi de `audit_log`'a (UPDATE/DELETE yasak) kopyalanıyordu.
- **Düzeltme:** misafir adı `secrets` ile saklanan kopyada maskelenir (teslim edilen e-posta tam metin; SMTP sağlayıcı tam metni
  şifreli `outbox_payloads`'ta tutar). `007_security_review.sql`: `audit_row()` `outbox` için `to_address/body/reply_to`'yu
  denetime yazmaz. `anonymizeGuest` gönderilmiş (`status='sent'`) satırlarda alıcıyı `[anonim]` yapar (kuyruktaki / başarısız
  satırlara dokunmaz, teslim çalışanı onları kullanır).
- **Test:** `G-06 …`.

### G-07 — Public RFQ dosya yükleme DoS (Orta)
- **Yer:** `routes/public.ts` `POST /api/public/rfq/:token/files`. **Düzeltme:** token önce (`resolvePublicToken`) doğrulanır,
  gövde DB işlemi dışında okunur, sonra tenant bağlamına geçilir.
- **Test:** `G-07 …` (geçersiz token + 21 MB → 404; önceden 413).

### G-14 — Kiracılar arası yabancı anahtar (Yüksek)
- **Yer:** tüm şema (83 tek sütunlu FK). PostgreSQL referans bütünlüğü kontrolleri tablo sahibi olarak çalışır ve RLS'yi
  uygulamaz: `INSERT … project_id = <A'nın projesi>` B bağlamında da kabul ediliyordu. Servislerin çoğu referansı önce RLS altında
  okuyor (`getProjectRow`, `createOfferVersion` tedarikçi kontrolü), ama hepsi değil: `createFieldIssue` (`supplierId`) ve
  `manualOffer` (`rfqId`) doğrulamadan yazıyordu — API üzerinden yeniden üretildi. Sonuç: A'nın kaydına bağlı yabancı satır
  (A'nın raporlarında / birleştirmelerinde görünmez ama veri bütünlüğü ve `ON` birleştirmeli sorgularda sızıntı riski).
- **Düzeltme:** `008_tenant_foreign_keys.sql` — idempotent `apply_tenant_foreign_keys()`: her FK için hedefte `(tenant_id, id)`
  benzersiz anahtarı ve `FOREIGN KEY (tenant_id, col) REFERENCES hedef (tenant_id, id)` ekler (NULL serbest). Servis koduna tek
  tek kontrol eklemek yerine veritabanında yapısal çözüm; yeni tablolar için migration'da yeniden çağrılır (README).
- **Test:** `G-14 …` (API: saha sorunu + manuel teklif 400 `INVALID_REFERENCE`; doğrudan SQL: `tasks`, `service_items`
  reddedilir; katalog: eşi olmayan FK kalmadı; aynı kiracıda referans çalışır).

- **Yan bulgu (doğruluk):** `services/contracts.ts` `quoteSnapshot` sözleşme koşullarını (ön ödeme oranı, para birimi, opsiyon)
  `ORDER BY`'sız `id = ANY(...)` sorgusunun **ilk** satırından alıyordu; 008'in yeni indeksi sorgu planını değiştirince sıra
  rastgeleleşti (salon teklifi önce gelince ön ödeme 0 → koşul riski / ön ödeme borcu kayboluyordu). Sıra teklif satırı sırasına
  sabitlendi (`ORDER BY array_position`). Öneri: "ilk satır" mantığı kullanan diğer `ANY(...)` sorgularında da sıra açık olmalı.

### G-08 … G-13 (Düşük)
- **G-08** `services/finance.ts`: ekstre en fazla `MAX_BANK_ROWS=5000` satır (`STATEMENT_TOO_LARGE`). Test `G-08`.
- **G-09** `services/closing.ts`: `UPDATE … WHERE answered_at IS NULL` + satır sayısı kontrolü. Test `G-09` (3 eşzamanlı → 1×200, 2×409).
- **G-10** `routes/operations.ts`: `GET /api/finance/bank-transactions` ve `/api/finance/commissions` yalnız admin + finans
  (web'de yalnız bu rollerin gördüğü `/finans` sayfası kullanıyor). Test `G-05` içinde.
- **G-11** `007_security_review.sql` (`auth_lookup_user`, `resolve_public_token` aktif tenant), `context.ts` (`withUserCtx` her
  istekte tenant durumunu kontrol eder). Test `G-11`.
- **G-12** yeni `src/security-headers.ts` (+ `server.ts` kaydı): `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, CSP (`default-src 'none'`; rıza HTML sayfası için yalnız satır içi stil + aynı kaynağa form),
  `/api/public/*` ve `/api/auth/*` için `Cache-Control: no-store`. Web `index.html` `<meta name="referrer" content="no-referrer">`
  (`/s/rfq/<token>` gibi URL'ler dış bağlantılara Referer ile gitmez). Test `G-12`.
- **G-13** `services/guests.ts`: public formdan proje başına en fazla `max(200, 2 × pax)` misafir (`ROOMING_LIMIT`). Test `G-06` içinde.

## İncelenip sorun bulunmayan alanlar (kanıt)
- **RLS:** (FK açığı için bkz. G-14) `tenant_id` taşıyan tüm tablolarda `ENABLE` + `FORCE` + `tenant_isolation`; `tenants` için de (`tenant_id` üretilmiş
  sütun). `mice_app` süper kullanıcı / BYPASSRLS değil, DELETE/TRUNCATE yok, `public` şemasında CREATE yok. `withTenant` dışında
  DB erişimi yalnız SECURITY DEFINER fonksiyonlar (`auth_lookup_user`, `resolve_public_token`, `app_tenant_ids`); hepsinde
  `search_path` sabit, yalnız hash / e-posta ile arama yapar, PUBLIC'ten EXECUTE geri alınmış. Worker tenantları
  `app_tenant_ids()` ile gezip her biri için ayrı `withTenant` açar.
- **SQL enjeksiyonu:** dinamik SQL yalnız sabit beyaz listelerden sütun adı (`PATCHABLE`, `COLS`) ve `$n` yer tutucularıyla
  kuruluyor; ORDER BY kullanıcıdan gelmiyor.
- **Public token'lar:** 32 bayt `randomBytes` (base64url), DB'de yalnız SHA-256; tek kalem / tek teklif / tek proje kapsamı;
  RFQ görünümü yalnız o tedarikçinin kendi sürümlerini döner (rakip fiyatı yok); müşteri teklif sayfasında maliyet / marj /
  markup yok; süre ve salt okunur durum sunucuda kontrol ediliyor; `/api/public/*` hız sınırlı. Hash araması tam eşitlik
  olduğundan sabit süreli karşılaştırma gerekmiyor.
- **AI yetki sınırı yapısal:** model araç (tool) kullanmıyor, çıktısı yalnız veri; her öneri `aiGate` → kapalı liste
  (`ai-authority.ts`, bilinmeyen = yasak) + `NEVER_AUTO_KINDS`; DB tetikleyicileri AI aktörüne para onayı, imza, akreditasyon ve
  kural yazımını yasaklıyor. Tedarikçi / müşteri metnindeki prompt injection ancak o tarafın zaten girebileceği verileri
  (teklif satırı, revizyon farkı) etkileyebilir.
- **Karar yolu:** `decide` `canDecide`'ı sunucuda yeniden çalıştırır, `FOR UPDATE` ile çift kararı önler, biyometri gereken
  türlerde `verifyStepUp` zorunlu; WebAuthn challenge'ı 5 dk geçerli, tek kullanımlık, kullanıcıya bağlı; sayaç kontrolü
  kütüphanede. Vekâlet tarih aralığı `activeDelegation` ile kontrol ediliyor.
- **XSS:** web'de `dangerouslySetInnerHTML` / `innerHTML` yok; API'nin döndürdüğü tek HTML (rıza geri çekme) kullanıcı girdisi içermez.
- **Dosya indirme:** belgeler DB'de (bytea); dosya sistemi yolu yok → path traversal yok; `Content-Disposition` adı kodlanıyor.
- **Hatalar:** 5xx yanıtları genel mesaj döner (yığın izi yok). Denetim kaydı parola hash'i, token hash'i, şifreli PII ve dosya
  verisini yazmaz.

## Kalan riskler / öneriler (düzeltilmedi)
1. **XLSX zip bombası:** tedarikçi (public link) ve finans yüklemeleri exceljs ile bellekte açılıyor; 20 MB sıkıştırılmış dosya
   GB'larca açılabilir. Öneri: ayrıştırmayı bellek sınırlı bir worker thread'e almak veya zip merkez dizinindeki açılmış boyutu
   akış hâlinde sınırlamak (beyan edilen boyut güvenilir değil).
2. **Ters vekil (proxy) arkasında hız sınırı:** Fastify `trustProxy` ayarlı değil; yük dengeleyici arkasında tüm istemciler tek
   IP görünür (tüm public sayfalar birlikte kısıtlanır). Docker / üretim kurulumunda güvenilen proxy adresiyle `trustProxy`
   ayarlanmalı; hız sınırı çok örnekli kurulumda Redis deposuna alınmalı.
3. **JWT localStorage'da, iptal yok:** XSS olursa belirteç çalınır (G-02 artık Face ID'yi korur). 12 saatlik belirteç şifre
   değişince iptal edilmez. Öneri: HttpOnly çerez + kısa ömürlü erişim / yenileme belirteci, `token_version` ile iptal.
   Web sunucusunda (nginx / CDN) CSP başlığı da verilmeli.
4. **Rol bazlı okuma kapsamı geniş:** proje detayı (kâr-zarar, marj), belgeler (P&L PDF), `/api/finance/entries`, karar
   ayrıntısı (`GET /api/decisions/:id`) ve taslaklar tenant içindeki her role açık; saha sorumlusu da iç marjları görebilir.
   PRD bunu açıkça yasaklamıyor — **[Ürün kararı]**: alan bazlı rol maskeleme (en az saha için).
5. **Taslak gönderimi rol kontrolü:** onay gerektirmeyen taslağı (ör. eksik bilgi sorusu) tenant içindeki herhangi bir rol kendi
   adresinden gönderebilir. Öneri: proje sahibi / satış-operasyon rolleriyle sınırlamak.
6. **Proje kodu tedarikçiye gidiyor:** `PRJ-####-MÜŞTERİ-…` RFQ e-postasında ve tedarikçi sayfasında; müşteri adı tedarikçiye
   açılıyor (müşteriyi atlama riski). **[Ürün kararı]**: tedarikçiye kısa kod (`PRJ-####`) göstermek.
7. **Müşteri teklifi otomasyonu:** `customer_quote` PRD §6'ya göre "öneri" ve terfi edilebilir; otomatiğe alınırsa biyometri
   gerektiren `quote_approval` AI tarafından onaylanır (gönderim yine insan). Biyometri gerektiren türlerin `NEVER_AUTO_KINDS`'a
   eklenmesi önerilir — **[Ürün kararı]** (PRD ile çelişebilir).
8. **Rooming rıza e-postası içeriği:** misafir adı (200 karakter) e-posta selamlamasında kullanılıyor; G-13 hacmi sınırlar ama
   içeriği değil. Öneri: selamlamayı adsız yapmak veya adı yalnız harf / boşlukla sınırlamak.
9. **PG hata mesajları:** `23505/23503/22P02` için Postgres mesajı istemciye dönüyor (kısıt / tablo adı). Düşük risk; üretimde
   genel mesaja çevrilebilir.
10. **Üretim loglaması:** Fastify logger yalnız `development`'ta açık; üretimde 5xx hataları hiç loglanmıyor. Yapılandırılmış
    log (PII'siz) açılmalı.
11. **`mice_app` parolası** migration'da `mice_app`; üretimde değiştirilmeli (README'de belirtilmiş).
12. **Askıya alınan acentada worker:** `app_tenant_ids()` zaten yalnız aktif tenantları döner; ancak askıya alma ile bekleyen
    outbox teslimleri ayrıca durdurulmuyor (teslim çalışanı kontrol etmeli).

## Değişen dosyalar
`apps/api/src/{config.ts, context.ts, server.ts, security-headers.ts (yeni)}`, `routes/{auth.ts, public.ts, operations.ts}`,
`services/{drafts.ts, finance.ts, guests.ts, closing.ts, phase-b-registry.ts, contracts.ts}`, `auth/webauthn.ts` (yorum),
`db/migrations/007_security_review.sql` ve `008_tenant_foreign_keys.sql` (yeni), `test/security-review.test.ts` (yeni), `test/offers.test.ts`,
`test/closing-admin.test.ts`, `vitest.config.ts` (`LOGIN_RATE_LIMIT`); `apps/web/{index.html, src/api/client.ts,
src/lib/webauthn.ts, src/components/AppShell.tsx, src/i18n/tr.ts}`; `.env.example`, `README.md`, `apps/api/README.md` (ortam
değişkenleri). `email.ts` ve `notifications.ts`'e dokunulmadı.
