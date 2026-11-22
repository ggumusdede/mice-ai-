# MICE AI Operations OS — Mühendislik Dokümanları

Bu klasör, Ürün Gereksinim Dokümanı (PRD) v0.4'ün **§18 "Mühendise açık sorular"** (17 soru) ve **§19 "Mühendislik tarafından beklenen sonraki teslimatlar"** (6 teslimat) bölümlerine mühendislik cevabıdır.

Dokümanlar repodaki kod sözleşmesine dayanır:

| Kaynak | İçerik |
|---|---|
| `packages/shared/src/enums.ts` | Roller, adımlar (0–8), statüler, karar kartı türleri |
| `packages/shared/src/models.ts` | Varlık şekilleri (API JSON) |
| `packages/shared/src/api.ts` | HTTP API sözleşmesi |
| `packages/shared/src/ai-authority.ts` | §6 kapalı yapay zekâ yetki listesi |
| `packages/shared/src/rules.ts` | Acenta bazlı varsayılan kural/eşik değerleri |
| `packages/domain/src/*.ts` | Saf iş kuralı fonksiyonları (birim testli) |
| `packages/ai/src/index.ts` | `AiService` arayüzü (Claude + deterministik mock) |
| `packages/ai/src/claude.ts`, `pii.ts`, `factory.ts` | Claude istemcisi (`claude-sonnet-5-5` / `claude-haiku-5-5`), PII maskeleme, `AI_*` ortam değişkenleri |
| `apps/api/README.md` | Gerçek rota listesi, sözleşmeden sapmalar, Faz B ayrıntıları, Mikro aktarım varsayımları |
| `apps/api/src/routes/*.ts`, `apps/api/src/services/*.ts` | Uygulanan uç noktalar ve iş servisleri |
| `apps/api/src/db/migrations/*.sql` | Gerçek tablolar, RLS, tetikleyiciler, §6 DB korumaları |
| `apps/api/test/*.test.ts` | Entegrasyon testleri (gerçek PostgreSQL; izolasyon, korumalar, adım 0–8) |

> Dokümanlar ilk olarak kod tamamlanmadan önce, API sözleşmesinin erken sürümüne göre yazılmıştı; Kasım 2026'da gerçek uygulamaya göre hizalandı. Uygulanmamış tasarım öğeleri metin içinde "henüz yok" / "önerilir" olarak işaretlidir.

## İçindekiler

| # | Doküman | PRD karşılığı | Özet |
|---|---|---|---|
| 01 | [Mimari](01-mimari.md) | §3, §7, §11 | Bileşenler, 0–8 veri akışı, tasarım ilkelerinin teknik uygulanışı |
| 02 | [Veri modeli](02-veri-modeli.md) | §19.1, §18.11, §18.13 | Tablolar, RLS kalıbı, silinmezlik, belge bağımlılıkları, izolasyon testi |
| 03 | [Yapay zekâ yetki matrisi](03-yapay-zeka-yetki-matrisi.md) | §19.2, §6 | Her işlem → servis/fonksiyon → izin → onay ekranı |
| 04 | [Doğruluk ölçümü](04-dogruluk-olcumu.md) | §19.3, §18.9 | Hedefler, test veri seti, güven eşiği kalibrasyonu, hata kaydı |
| 05 | [Faz 1 teknik planı](05-faz1-teknik-plan.md) | §19.4, §18.17 | Entegrasyon sırası, ekip, takvim, işletme maliyeti, SaaS birim maliyeti |
| 06 | [Otomasyon terfisi](06-otomasyon-terfisi.md) | §19.5, §18.12, §16 | Sayaç, 20 temiz onay, 1/20 örneklem, otomatik geri dönüş |
| 07 | [Mühendislik cevapları](07-muhendislik-cevaplari.md) | §18 (1–17) | 17 sorunun tamamına somut öneri |
| 08 | [Mobil karar](08-mobil-karar.md) | §19.6, §18.1 | Önce PWA; yerel iOS uygulamasını tetikleyen kriterler |

Ayrıca: güvenlik incelemesi ve kalan risklerin düzeltilmesi (G-01 … G-21, ürün kararı varsayılanları) — bkz. [09-guvenlik-incelemesi.md](09-guvenlik-incelemesi.md); üretim hazırlığı (Docker/CI) — bkz. ilgili repo dosyaları.
İş senaryoları kataloğu (102 API senaryosu, PRD § bazında, yeni PRD sürümleriyle genişler) — bkz. [10-senaryolar.md](10-senaryolar.md).

## Uygulama durumu

PRD bölümü / özellik → kodun bugünkü durumu. ✅ uygulandı · 🟡 kısmi · ⛔ henüz yok.

| PRD | Özellik | Durum | Kod / not |
|---|---|---|---|
| §3.1, §3.5 | Tek doğru kaynak, belgeler veriden; değişiklik yayılımı | ✅ | `services/documents.ts`, `documents-b.ts`; `003` `propagate_staleness`, `doc_kinds_for`, `documents_send_guard`, `quotes_send_guard` |
| §3.2, §15 | Onay kapıları, karar kutusu, Face ID step-up | ✅ | `services/decisions.ts`, `registry.ts`, `phase-b-registry.ts`; `domain/authority.ts` `requiresBiometric`; `auth/webauthn.ts`. Geliştirme biyometrisi yalnız `ALLOW_DEV_BIOMETRIC` |
| §3.3 | İnsan imzası, kullanıcının kendi adresinden gönderim | ✅ / 🟡 | Kural uygulanıyor (`services/drafts.ts` `sendDraft`); her mesaj `outbox`'a yazılır. SMTP "send as" (`EMAIL_PROVIDER=smtp`) ve **kullanıcı bazlı Gmail API / Microsoft Graph OAuth** (`EMAIL_PROVIDER=oauth`, `services/email-oauth.ts`, `mail-accounts.ts`, `016`): imzalı + süreli state, PKCE, şifreli belirteç, yenileme, bağlantı kesme; bağlı olmayan kullanıcı için SMTP / outbox / bekletme. **Uygulandı, canlı hesaplarla test edilmedi** (yalnız sahte HTTP ile) |
| §3.6 | Silinmez kayıt, append-only audit | ✅ | `003` `forbid_delete`, `audit_row`, `audit_redact`; bölümleme / hash zinciri ⛔ |
| §3.8, §18.11 | Çok kiracılılık (RLS) ve izolasyon testleri | ✅ / 🟡 | `apply_standard_policies`, `withTenant`; `apps/api/test/security.test.ts`. Eşzamanlılık ve property-based testler ⛔ (02 §7) |
| §6 | AI yetki listesi ve DB korumaları | ✅ | `ai-authority.ts`, `services/automation.ts` (`aiGate`, `NEVER_AUTO_KINDS`); `finance_money_guard`, `rules_change_guard`, `supplier_accreditation_guard`, `contract_sign_guard`, `contract_lock` |
| §7 Adım 0 | Talep analizi (yapıştırma / sesli not), proje kodu, mükerrer, eksik bilgi, atama | ✅ | `POST /api/intake`, `services/intake.ts`; sesli not tarayıcı Web Speech API ile (`apps/web/src/lib/speech.ts`) |
| §7 Adım 0 | Gelen e-posta / WhatsApp otomatik alımı (webhook, projeye bağlama) | 🟡 | ✅ İmzalı (HMAC + zaman penceresi) e-posta webhook'u + Postmark / Mailgun / ham MIME adaptörleri, isteğe bağlı IMAP yoklayıcı (`INBOUND_EMAIL_MODE=imap`); Message-ID / plus adres / konu etiketi / tek açık RFQ ile projeye bağlama; tedarikçi yanıtı → mevcut teklif okuma (yeni sürüm); müşteri kabul/revizyon → iç görev (otomatik kabul yok); bilinmeyen gönderen → talep (mükerrer kontrolü); Message-ID ile idempotent (`routes/inbound.ts`, `services/inbound/*`, `011`). WhatsApp Cloud API webhook'u (doğrulama, X-Hub-Signature-256, talep / projeye ekleme, ekstra onay butonu). ⛔ Gmail/Graph push (watch / subscriptions), SES SNS imza doğrulaması (yalnız `/mime` yönlendirici), WhatsApp medya indirme, bağlanamayan mail için AI proje önerisi, kişisel mail filtresi |
| §7 Adım 1 | Kısa liste, RFQ, tedarikçi linki, 24/48 sa takip | ✅ | `services/rfqs.ts`, `routes/public.ts`, `worker.ts`; e-postayla gelen tedarikçi yanıtları (metin / PDF / XLSX eki) otomatik okunur (`services/inbound/email-router.ts`) |
| §7 Adım 2 | Teklif okuma, normalizasyon, karşılaştırma, pazarlık | ✅ | `services/offers.ts`; AI `parseSupplierOffer` |
| §7 Adım 2, §18.5 | Kanal (OTA) fiyatı | 🟡 | Yalnızca manuel giriş (`POST /api/channel-prices`); OTA kanal API'si ⛔ |
| §7 Adım 3–4 | Müşteri teklifi, bloklama kuralları, PDF, online onay, PO / imzalı form, revizyon | ✅ | `services/quotes.ts`, `/api/public/quotes/:token/*`, `POST /api/quotes/:id/firm-approval` |
| §7 Adım 5 | Sözleşme okuma, fark, koşul riski, imza kilidi, ek protokol, taahhüt kaydı | ✅ | `services/contracts.ts`; ıslak imza + tarama dosya adı kaydı |
| §7 Adım 5 | e-imza entegrasyonu | ⛔ | İmza elle kaydedilir (`POST /api/contracts/:id/sign`) |
| §7 Adım 6 | Operasyon takvimi, rooming + KVKK rıza, saha ekstrası, saha sorunu, değişiklik akışı, günlük özet | ✅ | `routes/operations.ts`, `services/operations.ts`, `guests.ts` |
| §7 Adım 6 | Saha ekstrası müşteri SMS / WhatsApp linki | ✅ / 🟡 | WhatsApp şablonu (`extra_approve:<token>` butonu) veya SMS ağ geçidi (`SMS_PROVIDER=http`, Netgsm tarzı genel TR API — satıcı [Doğrulanmalı]); yapılandırılmamışsa `outbox` kaydı. **Uygulandı, canlı hesaplarla test edilmedi** |
| §7 Adım 7 | Tedarikçi faturası okuma, ödeme talebi → onay → "ödendi", banka CSV/XLSX eşleştirme, komisyon, müşteri faturası taslağı | ✅ | `services/finance.ts`; sistem para hareket ettirmez |
| §7 Adım 7, §18.4 | Mikro Yazılım | 🟡 | Excel dışa aktarımı ✅ (`GET /api/finance/export/mikro`, sütunlar **varsayım** — 07 §4); Mikro API ⛔; banka API'si ⛔ |
| §7 Adım 7, 07 §4 | e-Fatura / e-Arşiv UBL-TR XML okuma | ✅ / 🟡 | Deterministik okuyucu (`services/ubl-tr.ts`; KDV oran bazında, konaklama vergisi, ETTN, vade), `POST /api/finance/supplier-invoices` `.xml` → AI'sız (güven 1.0), tedarikçi VKN (`suppliers.tax_number`) / ad, ETTN tekilliği (`finance_entries.ubl_uuid`), mevcut tutar farkı alarmı. ⛔ Entegratör API'sinden otomatik çekme, ZIP paketleri, XAdES imza doğrulaması, e-postayla gelen XML'in otomatik faturaya dönüşmesi |
| §7 Adım 8 | Kapanış kontrolü, gerçekleşen fiyat, tedarikçi skoru, kontrol listesi önerisi, anket | ✅ | `services/closing.ts`, `routes/admin.ts` |
| §15 | Bildirimler (kritik anında, rutin 08:30 / 18:00 özeti) | ✅ / 🟡 | `services/notifications.ts`, `notifications` tablosu; VAPID anahtarlarıyla Web Push (`services/push.ts`, `push_subscriptions`, `/api/push/*`), anahtarsız konsol. Yedek kanal ✅: kritik push `criticalPushFallbackMinutes` (15 dk) içinde açılmazsa yöneticiye tek WhatsApp/SMS (`services/critical-fallback.ts`, imzalı açılma bağlantısı, idempotent) — **canlı hesaplarla test edilmedi**. APNs ⛔ |
| §15 | Üslup öğrenme | ✅ | `styleExamples` (düzeltmeler), `summarizeStyle` → `style_summaries` |
| §16 | Otomasyon terfisi (sayaç, terfi, örneklem, geri dönüş) | ✅ | `services/automation.ts`; bkz. 06 |
| §16.5 | Kural önerisi üreticisi | ✅ / 🟡 | Saf kural motoru `packages/domain/src/rule-suggestions.ts` (tedarikçi × sezon avantajı → kapsamlı sezon markup'ı, tutarlı markup düzeltmeleri → kademe tablosu, RFQ yanıt süreleri → genel / tedarikçiye özel takip saatleri, marj istisnaları → hedef marj, müşteri karar süreleri → opsiyon günü); haftalık idempotent worker işi + `POST /api/rules/suggestions/run` (`services/rule-suggestions.ts`), yalnız yönetici kararı (`rule_suggestion`, dayanak veri tablosu), uygulama denetimli `setRule` ile, AI aktörü DB'de engelli. Örnek boyutu / eşikler sabit varsayılandır, gerçek veriyle ayarlanmadı; yeni kapsamlı kurallar: `supplierSeasonMarkups` (yalnız fiyat sınıfı bilinmiyorsa), `supplierRfqHours` |
| §8 | İlk veri yükü (son 12–18 ayın kapanmış projeleri, elle doğrulanarak) | ✅ / 🟡 | Yönetim → Veri aktarımı: XLSX/CSV şablonları (tedarikçi, müşteri, kapanmış proje, hizmet kalemi alış/satış, fiyat geçmişi, kanal fiyatı) → `015` staging (`import_batches/files/rows`, RLS) → satır doğrulama (zorunlu alan, TR sayı/tarih, pencere kuralı `initialImportWindowMonths`=18, mükerrer, kur, alış ≤ satış, VKN → ad ile eşleştirme) → **elle doğrulama** (satır / toplu onay-ret, satır içi düzeltme) → tek işlemde, yönetici aktörlü ve `import_batch_id`'li aktarım; projeler `historical` (aktif liste / karar kutusu / takip / işçi dışında; benzer projeler, fiyat medyanı, skor, kural önerisi besler); akreditasyon karar kutusundan; vazgeçme durumla (`services/initial-import.ts`, `routes/import.ts`, `domain/initial-import.ts`, `e2e/import.mjs`). Geçmiş kurlar ⛔ (güncel kayıtlı kur kullanılır [Doğrulanmalı]); geçmiş sözleşme / fatura / misafir aktarımı ⛔ |
| §16.6 | Haftalık gelişim raporu | ✅ | `GET /api/reports/weekly`, `services/reports.ts` |
| §17.9, §18.2 | KVKK: PII şifreleme, rol bazlı maskeleme, rıza / geri çekme, anonimleştirme; modele giden metinde maskeleme | ✅ / 🟡 | `services/guests.ts`, `packages/ai/src/pii.ts`; PDF/görsel maskelenmez (07 §2 sınırlar) |
| §18.9, 04 | Doğruluk test seti, eşik kalibrasyonu | 🟡 | Değerlendirme koşucusu ✅ `npm run eval -w @mice/ai -- --provider=mock\|claude --set=…` (`packages/ai/eval/`: alan bazlı doğruluk, kalibrasyon tablosu + ECE, hedef kesinlik için eşik önerisi, Wilson sınırlı varyant; Markdown + JSON rapor); 25 belgelik **sentetik** TR/EN/RU etiketli set (talep, teklif, sözleşme, fatura; `--as-pdf` ile pdfkit PDF); gerçek düzeltmelerden set üretimi `apps/api/src/scripts/export-eval-set.ts` (PII maskeli). Gerçek etiketli set (docs/04 §3 hedef adetleri), Claude ile ölçüm, CI kapısı, alan türü bazlı eşiklerin kurala yazılması ⛔ |
| §18.16 | Saha paneli çevrimdışı kuyruk | 🟡 | `apps/web/src/lib/offlineQueue.ts` (IndexedDB) yalnız saha işlemleri; tam offline PWA önbelleği ⛔ |
| §18.6, §18.7 | Gerçek e-posta (Gmail API / MS Graph OAuth) ve WhatsApp Business API | 🟡 | **Uygulandı, canlı hesaplarla test edilmedi:** Gmail/Graph kullanıcı OAuth gönderimi (`EMAIL_PROVIDER=oauth`), WhatsApp Cloud API gönderimi (şablon + 24 sa pencere metni, durum webhook'u → `outbox.delivery_status`; `MESSAGING_PROVIDER=whatsapp_cloud`), SMS ağ geçidi. ⛔ Gmail `users.watch` / Graph abonelikleri (gelen posta), Meta Embedded Signup (SaaS), şablon onayı (07 §7 adımları) |
| §18.8 | Sunucu tarafı konuşma tanıma (STT) | ⛔ | Tarayıcı Web Speech API kullanılır |
| §18.1, 08 | Yerel iOS uygulaması | ⛔ | Faz 1 PWA (08 kriterleri) |
| — | Oturum iptali (`users.token_version`, şifre değiştirme, "her yerden çıkış"), işçi lider kilidi (advisory lock), XLSX zip bombası koruması, PG hata metni temizliği, çok örnekli hız sınırı deposu (Redis, isteğe bağlı) | ✅ | 09 G-17 … G-21; `010_session_revocation.sql`, `worker-lock.ts`, `lib/zip-guard.ts`, `errors.ts`, `rate-limit-store.ts` |
| §4, §10, §15, §16 | **[Ürün kararı]** güvenli varsayılanlar (acenta kuralı, Kurallar → "Ürün kararları"): `hideCustomerFromSuppliers` (açık — tedarikçi `PRJ-0042-20270312-80` görür), `fieldRoleCanSeeFinancials` (kapalı — saha kâr / maliyet / finans görmez, sunucuda), `neverAutomateKinds` (müşteri teklifi onayı + marj altı açma asla otomatik), `outboundAutoSendRequiresStandingApproval` (kapalı — terfi edilmiş dış mesajlar yine onaya gelir) | ✅ | 09 G-15, G-16, Ü-1; `services/visibility.ts`, `services/automation.ts` |
| — | SSO, yenileme belirteci (HttpOnly çerez), nesne deposu | ⛔ | 01 §1, §3, §6 |
| §4–§17 | İş senaryoları (API düzeyi, akıcı senaryo kurgusu) | ✅ | `apps/api/test/scenarios/*.test.ts`, `_scenario.ts`; katalog ve açık sorular [10-senaryolar.md](10-senaryolar.md) |
| §15, §4–§17 | Tarayıcı senaryoları (17 Playwright senaryosu + `e2e/run-all.mjs` özet tablosu) | ✅ | `e2e/scenarios/*.mjs`, `e2e/lib/*.mjs`; [10-senaryolar.md → Tarayıcı senaryoları](10-senaryolar.md#tarayıcı-senaryoları) |
| — | Güvenlik incelemesi; üretim kurulumu (Docker/CI) | — | Eşzamanlı ekleniyor; bkz. [09-guvenlik-incelemesi.md](09-guvenlik-incelemesi.md) ve üretim hazırlığı dosyaları |

## Okuma kılavuzu

- **Acenta yönetimi:** 07 (cevaplar), 05 (maliyet/takvim), 08 (mobil karar).
- **Geliştirici:** 01 → 02 → 03 → 06 → 04.
- **Avukat / KVKK danışmanı:** 07 §2 ve §15, 02 "Kişisel veri katmanı".

## İşaretleme kuralları

- **[Doğrulanmalı]** — üçüncü taraf ürün yeteneği, fiyat veya mevzuat yorumu. Karar vermeden önce satıcıdan veya avukattan teyit alınmalıdır.
- **[Ürün kararı]** — teknik olarak her iki yol da mümkün; acenta yönetiminin seçmesi gerekir.
- Tutarlar **aralık ve varsayım** olarak verilmiştir. Kesin fiyat iddiası yoktur. Kur varsayımı (EUR/TRY) 05'te açıkça belirtilmiştir.
