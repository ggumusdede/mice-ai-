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
| G-15 | Orta | Tedarikçiye giden her çıktıda (RFQ e-postası / hatırlatması, tedarikçi formu, pazarlık, konfirmasyon, revizyon, rooming list, `X-MICE-Project` başlığı) müşteri adını içeren proje kodu (kalan risk 6) | Düzeltildi — **[Ürün kararı]** `hideCustomerFromSuppliers` |
| G-16 | Orta | Saha rolü kâr / P&L / finans kayıtları / teklif maliyet-marj / başkalarının taslaklarını görebiliyordu; onaysız taslağı herkes gönderebiliyordu (kalan risk 4, 5) | Düzeltildi — **[Ürün kararı]** `fieldRoleCanSeeFinancials` |
| G-17 | Orta | JWT iptal edilemiyordu (şifre / rol değişikliği, pasife alma sonrası 12 saat geçerli) (kalan risk 3) | Düzeltildi |
| G-18 | Orta | XLSX zip bombası: exceljs 20 MB dosyayı GB'larca açabilirdi (kalan risk 1) | Düzeltildi |
| G-19 | Düşük | Postgres hata metni (kısıt / tablo adı) istemciye dönüyordu; 5xx loglarında DETAIL (satır değerleri) (kalan risk 9) | Düzeltildi |
| G-20 | Düşük | Çok örnekli worker kurulumunda işler (otonom RFQ hatırlatması, özetler, e-posta yeniden denemesi) her örnekte çalışırdı | Düzeltildi |
| G-21 | Düşük | Çok örnekli API'de hız sınırı örnek başına bellekte (kalan risk 2'nin ikinci yarısı) | Düzeltildi (isteğe bağlı Redis deposu) |
| Ü-1 | **[Ürün kararı]** | Müşteri teklifi otomasyonu × §15 biyometri; terfi edilmiş dış mesajların otomatik gönderimi (kalan risk 7) | Güvenli varsayılan: `neverAutomateKinds`, `outboundAutoSendRequiresStandingApproval=false` |

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

### G-15 … G-21 ve Ü-1 (kalan risklerin düzeltilmesi, Kasım 2026)

Ürün sahibinin henüz karar vermediği her konu **acenta kuralıdır** (`packages/shared/src/rules.ts` `DEFAULT_RULES`, eklemeli;
yönetici "Kurallar" ekranındaki "Ürün kararları" kartından değiştirir; `PATCH /api/rules` admin + insan). Varsayılan her zaman
daha muhafazakâr seçenektir. Testler: `apps/api/test/security-residual.test.ts` (+ `contracts-automation`, `closing-admin`,
`delivery`, `packages/domain/test/misc.test.ts`); e2e: `e2e/steps0-5.mjs` tedarikçi sayfası ve saha kullanıcısı kontrolleri.

- **Ü-1 [Ürün kararı] otomasyon × biyometri.** `neverAutomateKinds` (varsayılan `customer_quote`, `quote_approval`,
  `margin_override`): AI eylem türü veya karar türü; `aiGate` bu türleri sayaç `auto` olsa bile onaya düşürür,
  `recordAutomationOutcome` terfi önerisi üretmez, `promoteAction` (ve eski bir terfi kartı) `NOT_PROMOTABLE` ile reddeder. §6 yapısal
  listesi (`NEVER_AUTO_KINDS`) üstte kalır. `outboundAutoSendRequiresStandingApproval` (varsayılan **false**): **mevcut davranış
  doğrulandı** — terfi edilmiş dış mesaj türleri (RFQ, pazarlık, opsiyon uzatma / takip, revizyon) önceden *otomatik gönderiliyor*,
  örneklem denetimi gönderimden *sonra* yapılıyordu. Varsayılan artık daha sıkı: `auto` modda bile bu kartlar tek dokunuşla onaya
  gelir (`detail.automation='outbound_held_for_approval'`); `true` yapılırsa yöneticinin terfi kararı kalıcı onay sayılır ve eski
  davranış (otomatik gönderim + ~1/20 örneklem) geri gelir. Terfi kartının AI notu bu durumu söyler. Test: `§15 × §16 …`,
  `contracts-automation.test.ts` `automation (§16)`.
- **G-15 [Ürün kararı] tedarikçiye müşteri adı.** `hideCustomerFromSuppliers` (varsayılan **true**). `domain/project-code.ts`
  `supplierSafeCode`: `PRJ-0042-ACME-20270312-80-HILTON` → `PRJ-0042-20270312-80` (beklenmeyen biçimde yalnız `PRJ-0042`).
  `services/visibility.ts` `supplierRef()` kullanılan yerler: RFQ taslağı (`rfqs.ts`), public RFQ görünümü, worker RFQ hatırlatma
  şablonu, pazarlık (`offers.ts`), opsiyon uzatma (`worker.ts`), revizyon talebi ve tedarikçi konfirmasyonu (`contracts.ts`),
  rooming list Excel'i (otele gider; dosya adı dahil). `X-MICE-Project` başlığı her alıcı için kısa kod (`PRJ-0042`). Sözleşme
  alanları (müşteri / fatura adı) bilinçli olarak değişmedi — sözleşme bunu gerektirir; e-posta konuları ise kodu taşımaz.
  Test: `G-15 …` (taslak, gönderilen e-posta, tedarikçi sayfası, 24 sa hatırlatma, kural kapatılınca tam kod).
- **G-16 [Ürün kararı] saha rolü ve taslak gönderimi.** `fieldRoleCanSeeFinancials` (varsayılan **false**), sunucuda:
  `projectDetail` kâr, teklifler / değerlendirmeler, kalem alış / satış, müşteri teklifleri, sözleşmeler, finansal belgeler (P&L,
  teklif, müşteri fatura taslağı) ve para içeren satırların audit görüntülerini çıkarır; zaman çizelgesi, benzer projeler ve "Bu
  projeye sor" bağlamı da kısılır. `403 FINANCIALS_HIDDEN`: `/api/quotes/:id(/pdf)`, `/api/projects/:id/contracts`,
  `/api/contracts/:id`, `/api/items/:id/comparison`, `/api/finance/entries`, finansal belge dosyası / yeniden üretimi, kendi karar
  kutusunda olmayan karar ayrıntısı. Taslak listesi yalnız kendi (`from_user_id`) taslakları; başkasının taslağını düzenleyemez.
  Web: para sekmeleri, kâr bloğu, P&L üretimi ve maliyet sütunları saha rolünde gizli (`lib/visibility.ts`). **Taslak gönderimi
  (kural değil, her rolde):** `POST /api/drafts/:id/send` yalnız taslağın sahibi veya yönetici (`403 DRAFT_NOT_OWNER`). Test: `G-16 …`.
- **G-17 oturum iptali.** `010_session_revocation.sql` `users.token_version`; JWT `tv` taşır, `withUserCtx` her istekte aynı
  kullanıcı satırıyla karşılaştırır (önbelleksiz, ek sorgu yok); `tv`'siz eski belirteç reddedilir. Artış: `POST /api/auth/password`
  (yeni şifre ≥ 10, mevcut şifreyle yeniden doğrulama; bu oturuma yeni belirteç döner), `PATCH /api/users/:id` rol / yetki seviyesi /
  kapsam / imza / aktiflik değişikliği (ad değişikliği değil), `POST /api/users/:id/revoke-sessions` ("her yerden çıkış", yalnız
  yönetici). Varsayılan ömür 12 sa → **8 sa** (`JWT_TTL`, eski `JWT_EXPIRES_IN` okunur). Web: profil sayfasında şifre değiştirme,
  Kullanıcılar ekranında "Oturumları kapat". HttpOnly çerez + yenileme belirteci hâlâ öneri. Test: `G-17 …`, `closing-admin.test.ts`.
- **G-18 XLSX zip bombası.** `apps/api/src/lib/zip-guard.ts` (bağımlılıksız): merkez dizin okunur; ZIP64 / şifreli / bilinmeyen
  sıkıştırma reddedilir; her girdi `inflateRawSync(maxOutputLength = kalan bütçe)` ile **gerçek** boyutu ölçülerek açılır (beyan edilen
  boyuta güvenilmez, üst üste binen girdiler ortak bütçeye takılır); sınırlar 30 MB açılmış, oran 100 (≥ 1 MB girdilerde ve toplamda),
  2000 girdi (`XLSX_MAX_*`). `xlsxToCsv` exceljs'ten önce çağırır → tüm xlsx yüklemeleri (teklif, fatura, sözleşme, banka ekstresi,
  public RFQ dosyası) `400 UNSAFE_ARCHIVE`. Test: `G-18 …` (gerçek xlsx geçer; deflate bombası, yalan boyut, yüksek oran, 2001 girdi,
  zip olmayan dosya; multipart banka ekstresi).
- **G-19 Postgres hata metni.** `errors.ts`: bilinen SQLSTATE'ler genel Türkçe mesaj (kısıt adı da dönmez), bilinmeyen PG hatası
  500 genel mesaj; kendi tetikleyici metinlerimiz (`MIxxx`) korunur. Log yalnız `pgLogFields()` (kod, kısıt, tablo, sütun, mesaj) —
  DETAIL (satır değerleri) asla. Test: `G-19 …`.
- **G-20 worker lider kilidi.** `src/worker-lock.ts`: ayrılmış bağlantıda oturum düzeyi `pg_try_advisory_lock`; lider kilidi yaşadığı
  sürece tutar, bağlantı koparsa kilit düşer ve bekleyen örnek bir sonraki turda devralır. `runIfLeader()` bekleyende `null` döner
  ("worker standby" logu). Test: `G-20 …`.
- **G-21 hız sınırı deposu.** `RATE_LIMIT_REDIS_URL` → `@fastify/rate-limit`'in yerleşik Redis deposu (giriş, `/api/public/*`,
  public-b, inbound); `ioredis` isteğe bağlı paket (yüklü değilse API açılmaz — sessizce örnek başına sınıra düşmez). Redis kesintisinde
  `skipOnError` (API ayakta kalır). `trustProxy` için `TRUST_PROXY` zaten var. Test: `G-21 …` (yapılandırma; gerçek Redis'e karşı test yok).

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

## Kalan riskler / öneriler
Durum Kasım 2026 (G-15 … G-21 sonrası):
1. ~~XLSX zip bombası~~ — **düzeltildi (G-18)**.
2. **Ters vekil (proxy) arkasında hız sınırı:** `TRUST_PROXY` ile çözülür (kurulumda ayarlanmalı). Çok örnekli kurulumda ortak depo
   **düzeltildi (G-21, `RATE_LIMIT_REDIS_URL`)**.
3. **JWT localStorage'da:** iptal **düzeltildi (G-17**, `token_version`, 8 sa). Kalan öneri: HttpOnly çerez + kısa ömürlü erişim /
   yenileme belirteci; web sunucusunda (nginx / CDN) CSP başlığı.
4. ~~Rol bazlı okuma kapsamı geniş~~ — **düzeltildi (G-16)**, **[Ürün kararı]** `fieldRoleCanSeeFinancials` (varsayılan kapalı).
   Satış / operasyon rolleri için alan maskeleme hâlâ ürün kararı.
5. ~~Taslak gönderimi rol kontrolü~~ — **düzeltildi (G-16)**: yalnız taslak sahibi veya yönetici.
6. ~~Proje kodu tedarikçiye gidiyor~~ — **düzeltildi (G-15)**, **[Ürün kararı]** `hideCustomerFromSuppliers` (varsayılan açık).
7. ~~Müşteri teklifi otomasyonu~~ — **güvenli varsayılan (Ü-1)**, **[Ürün kararı]** `neverAutomateKinds`,
   `outboundAutoSendRequiresStandingApproval`.
8. **Rooming rıza e-postası içeriği:** misafir adı selamlamada (değişmedi). Öneri: adsız selamlama.
9. ~~PG hata mesajları~~ — **düzeltildi (G-19)**.
10. **Üretim loglaması:** pino JSON log artık açık (`LOG_LEVEL`); PG hataları yalnız temizlenmiş alanlarla loglanır (G-19).
11. **`mice_app` parolası:** `migrate:deploy` + `APP_DB_PASSWORD` (README).
12. **Askıya alınan acentada worker:** bekleyen outbox teslimleri ayrıca durdurulmuyor (değişmedi).
13. **Yeni (G-21):** Redis deposu gerçek Redis'e karşı test edilmedi (yalnız yapılandırma testi); devreye almadan önce staging'de
    doğrulanmalı. **Yeni (G-16):** satış rolünün `PATCH /api/users` web ekranı her kayıtta `authorityScope` gönderir; kapsam JSON'u
    farklı sırada gelirse kullanıcının oturumu gereksiz yere kapanabilir (güvenli yönde hata).

## Değişen dosyalar
`apps/api/src/{config.ts, context.ts, server.ts, security-headers.ts (yeni)}`, `routes/{auth.ts, public.ts, operations.ts}`,
`services/{drafts.ts, finance.ts, guests.ts, closing.ts, phase-b-registry.ts, contracts.ts}`, `auth/webauthn.ts` (yorum),
`db/migrations/007_security_review.sql` ve `008_tenant_foreign_keys.sql` (yeni), `test/security-review.test.ts` (yeni), `test/offers.test.ts`,
`test/closing-admin.test.ts`, `vitest.config.ts` (`LOGIN_RATE_LIMIT`); `apps/web/{index.html, src/api/client.ts,
src/lib/webauthn.ts, src/components/AppShell.tsx, src/i18n/tr.ts}`; `.env.example`, `README.md`, `apps/api/README.md` (ortam
değişkenleri). `email.ts` ve `notifications.ts`'e dokunulmadı.

**G-15 … G-21 değişen / yeni dosyalar:** `packages/shared/src/rules.ts` (4 kural), `packages/domain/src/project-code.ts`
(`supplierSafeCode`), `apps/api/src/{config.ts, context.ts, errors.ts, worker.ts, worker-lock.ts (yeni), rate-limit-store.ts (yeni),
lib/zip-guard.ts (yeni), services/visibility.ts (yeni)}`, `routes/{_helpers.ts, auth.ts, admin.ts, core.ts, operations.ts, public.ts,
public-b.ts, inbound.ts (yalnız hız sınırı deposu)}`, `services/{automation.ts, decisions.ts, projects.ts, rfqs.ts, offers.ts,
contracts.ts, documents-b.ts, email-smtp.ts}`, `db/seed.ts`, `db/migrations/010_session_revocation.sql`;
`apps/web/src/{lib/visibility.ts, components/PasswordChange.tsx (yeni), components/AppShell.tsx, api/client.ts,
pages/admin/RulesPage.tsx, pages/admin/UsersPage.tsx, pages/project/{ProjectPage, SidePanel, OverviewTab}.tsx}`; testler
`apps/api/test/security-residual.test.ts` (yeni), `contracts-automation.test.ts`, `closing-admin.test.ts`, `delivery.test.ts`,
`packages/domain/test/misc.test.ts`; `e2e/steps0-5.mjs`.
