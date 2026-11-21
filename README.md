# MICE AI Operations OS

Kurumsal toplantı, kongre, teşvik gezisi ve etkinlik (MICE) organize eden butik seyahat acentaları için **yapay zekâ destekli
operasyon sistemi** — PRD v0.4'ün çalışan uygulaması. Talep gelir → hizmet kalemleri belirlenir → tedarikçi teklifleri toplanır
→ müşteri teklifi onaylanır → sözleşme → operasyon → fatura / ödeme / tahsilat → kapanış ve öğrenme. Her aşama **tek proje
kaydına** bağlıdır; belgeler veriden üretilir, yapay zekâ taslak hazırlar, para / taahhüt / dış iletişim içeren her adım
insan onayından (karar kutusu, gerektiğinde Face ID) geçer.

> **English summary.** MICE AI Operations OS is an AI-assisted operations system for MICE travel agencies (PRD v0.4).
> One project record carries a request from intake through supplier RFQs, offer comparison, a validated customer quote,
> contracts, on-site operations, finance (invoices, payment approvals, bank matching, Mikro export) and closing/learning.
> AI (Claude, or a deterministic mock) only drafts and suggests; every money, contract or outbound step is a human decision
> in a mobile decision inbox (WebAuthn/Face ID step-up for money and contract approvals). Multi-tenant PostgreSQL with RLS,
> append-only audit, no deletes, and automatic staleness of documents when their data changes. Monorepo: shared contract +
> pure domain rules + AI service + Fastify API + React/Vite PWA. Quick start below; demo logins `admin@demo.test` … / `demo1234`.

## İçindekiler

- [Sistem özeti (PRD v0.4)](#sistem-özeti-prd-v04)
- [Mimari ve monorepo düzeni](#mimari-ve-monorepo-düzeni)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [PRD ilkeleri → kod](#prd-ilkeleri--kod)
- [Testler](#testler)
- [End-to-end UI senaryoları (adım 0–5 ve 6–8)](#end-to-end-ui-senaryoları)
- [Dağıtım (Docker, CI, iletişim kanalları, operasyon)](#dağıtım-docker-ci-iletişim-kanalları-operasyon)
- [Bilinen sınırlar / sonraki adımlar](#bilinen-sınırlar--sonraki-adımlar)

## Sistem özeti (PRD v0.4)

**Hedefler (§1):** talep → fiyatlı teklif süresi 3–4 günden **2 iş gününe**; teklif / sözleşme / program / kâr-zarar
arasındaki tutarsızlıkların yapısal olarak sıfırlanması; tekrarlayan işlerin yapay zekâya devri; her kapanan projenin fiyat,
tedarikçi ve talep bilgisinin bir sonraki işe geri beslenmesi.

**İş akışı (§7, adım 0–8)**

| Adım | Ekranda | Arka planda |
|---|---|---|
| 0 Talep analizi | "Yeni talep": e-posta / WhatsApp / telefon notu / sesli not yapıştır | AI ayıklama + güven skoru, mükerrer kontrolü, eksik bilgi soru taslağı, tedarikçi ön eşleşme, atama önerisi; proje kodu `PRJ-####-MÜŞTERİ-TARİH-KİŞİ-MEKÂN` |
| 1 RFQ | Kalemler & RFQ: kısa liste, 3–5 tedarikçi | `rfq_send` kararı, tek kullanımlık tedarikçi linki `/s/rfq/<token>`, hatırlatma / telefon görevi |
| 2 Karşılaştırma | Teklifler, karşılaştırma, pazarlık taslağı | AI teklif okuma (PDF/Excel/e-posta), normalizasyon, kanal fiyatı / geçmiş medyan, gizli maliyetler; rakip fiyatı argüman olamaz |
| 3 Müşteri teklifi | Teklif oluşturucu (2–3 seçenek) | Marj ≥ hedef, opsiyon tarihi ≤ tedarikçi opsiyonu, aday tedarikçi blok; kişi bazlı yetki → `quote_approval` (Face ID) |
| 4 Müşteri onayı | `/q/<token>` (online veya PO / imzalı form) | kazanıldı / kaybedildi (nedenli), revizyon talebi |
| 5 Sözleşme | Şablondan sözleşme, alan alan fark, koşul riski | temiz olmadan imza yok; `contract_approval` (Face ID); imzada kilit + borç / alacak kayıtları |
| 6 Operasyon | Görev takvimi, günlük özet, saha paneli, rooming | imzada görev takvimi; rooming formu `/r/<token>` (KVKK rızası), saha ekstrası (5.000 / 15.000 TL limit, müşteri onayı `/e/<token>`), değişiklik akışı |
| 7 Finans | Finans sekmesi + **/finans** sayfası | tedarikçi faturası (AI okuma, tutar alarmı), ödeme talebi → yönetici onayı (Face ID) → insan "ödendi" işaretler; banka ekstresi eşleştirme; komisyon mutabakatı; müşteri faturası taslağı + Mikro'da kesilen fatura no; Mikro Excel aktarımı |
| 8 Kapanış | Kapanış kontrolü, plan vs gerçekleşen | gerçekleşen fiyatlar → fiyat geçmişi, tedarikçi skoru, "neyi geç öğrendik?" → kontrol listesi önerisi, 3 soruluk anket `/survey/<token>` |

Ayrıca: haftalık gelişim raporu (§16.6), kurallar / kullanıcılar / vekâlet / otomasyon / kontrol listesi / tedarikçi / müşteri
yönetimi, otomasyon terfisi (N temiz onay → otomatik, ~1/20 örneklem denetim, hatada geri dönüş), bildirimler (kritik anında,
rutin 08:30 / 18:00 özet).

## Mimari ve monorepo düzeni

```
packages/shared   @mice/shared  — tek doğru kaynak sözleşme: enum'lar, modeller, HTTP API (api.ts), §6 AI yetki listesi, varsayılan kurallar
packages/domain   @mice/domain  — saf iş kuralı fonksiyonları (marj/markup, teklif doğrulama, sözleşme farkı, yetki & vekâlet,
                                  biyometri gereksinimi, banka eşleştirme, KVKK saklama, proje kodu, iş günü hesabı …) + birim testleri
packages/ai       @mice/ai      — AiService arayüzü: ClaudeAiService (Anthropic SDK) ve deterministik MockAiService, PII maskeleme
apps/api          @mice/api     — Fastify 5 + PostgreSQL 16 (RLS), JWT, WebAuthn, pdfkit, exceljs; worker (takip / KVKK / özet işleri)
apps/web          @mice/web     — React 18 + Vite PWA (mobil öncelikli karar kutusu, masaüstü proje ekranı, public token sayfaları)
e2e/              Playwright UI senaryoları (adım 0–5 ve 6–8)
docs/             mühendislik dokümanları (mimari, veri modeli, AI yetki matrisi, doğruluk ölçümü, faz planı, otomasyon, mobil karar)
scripts/          db-start.sh (yerel Postgres 16, `mice` + `mice_test`)
```

İstek akışı: web (`/api` proxy) → Fastify route (`apps/api/src/routes/*`, kayıt indeksi `routes/index.ts`) → `withTenant`
(transaction + `SET LOCAL app.tenant_id / user / actor / device`) → servis (`apps/api/src/services/*`) → `@mice/domain` kuralları
ve `@mice/ai` → PostgreSQL (RLS + tetikleyiciler: denetim kaydı, silme yasağı, belge eskime yayılımı, kilitler).
Ayrıntılar: [`docs/01-mimari.md`](docs/01-mimari.md), API: [`apps/api/README.md`](apps/api/README.md).

## Hızlı başlangıç

Gereksinimler: Node ≥ 20, PostgreSQL 16 (yerelde `scripts/db-start.sh` kurar/başlatır), Playwright yalnızca e2e için.

```bash
npm install
bash scripts/db-start.sh                       # Postgres :5432 — mice + mice_test veritabanları
npm run migrate -w apps/api                    # migration'lar (schema_migrations)
npm run seed -w apps/api -- --reset            # demo acenta "Demo MICE Acenta" (şemayı sıfırlar)
AI_PROVIDER=mock npm start -w apps/api         # API → http://localhost:3001 (GET /api/health); geliştirmede `npm run dev -w apps/api`
(cd apps/web && npx vite)                      # Web → http://localhost:5173 (/api → :3001 proxy)
npm run worker -w apps/api                     # (isteğe bağlı) takipler, KVKK anonimleştirme, özetler; `-- --once`
```

Demo girişleri (şifre **`demo1234`**):

| E-posta | Rol |
|---|---|
| `admin@demo.test` | Yönetici (karar kutusu, kurallar, rapor, finans) |
| `clerk@demo.test` | Satış (Marmara Teknoloji için kapsamlı yetki) |
| `ops@demo.test` | Operasyon (misafir verisini görür) |
| `field@demo.test` | Saha sorumlusu (saha paneli) |
| `finance@demo.test` | Finans (fatura, ödeme talebi, banka, Mikro) |

Gerçek Claude ile çalıştırmak için `ANTHROPIC_API_KEY` verin ve `AI_PROVIDER` değerini boş bırakın (veya `claude`).

## Ortam değişkenleri

Tam liste ve açıklamalar: [`.env.example`](.env.example) (uygulamalar `process.env` okur; dosyayı `set -a; . ./.env; set +a`
veya `node --env-file=.env` ile yükleyin).

| Değişken | Varsayılan | Not |
|---|---|---|
| `DATABASE_URL` | `postgres://mice_app:mice_app@localhost:5432/mice` | **süper kullanıcı olmayan** `mice_app` rolü (RLS) |
| `MIGRATION_DATABASE_URL` | `postgres://postgres@localhost:5432/mice` | yalnız migration / seed |
| `JWT_SECRET`, `JWT_TTL` (eski ad `JWT_EXPIRES_IN`) | dev sırrı, `8h` | sır üretimde zorunlu; oturumlar `users.token_version` ile iptal edilir (şifre / rol / yetki değişikliği, pasife alma, `POST /api/users/:id/revoke-sessions`) |
| `RATE_LIMIT_REDIS_URL` | – | çok örnekli API: hız sınırları ortak Redis deposunda (isteğe bağlı `ioredis` paketi gerekir); boşsa örnek başına bellek |
| `XLSX_MAX_UNCOMPRESSED_MB`, `XLSX_MAX_RATIO`, `XLSX_MAX_ENTRIES` | 30, 100, 2000 | XLSX zip bombası koruması (exceljs'ten önce) |
| `GUEST_DATA_KEY` | dev anahtarı | misafir kişisel verisi (pgcrypto) — üretimde zorunlu, DB'de saklanmaz |
| `ALLOW_DEV_BIOMETRIC` | – | `{biometric:{method:'dev'}}` yalnız `NODE_ENV` `development` / `test` iken veya `1` ise kabul edilir (demo / e2e) |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` | `localhost`, … | Face ID / WebAuthn |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | tedarikçi / müşteri / rooming / ekstra / anket linklerinin öneki |
| `CORS_ORIGIN`, `PUBLIC_RATE_LIMIT`, `LOGIN_RATE_LIMIT`, `PORT`, `HOST` | | giriş: dakikada IP başına 20 deneme |
| `ANTHROPIC_API_KEY` | – | yoksa mock AI |
| `AI_PROVIDER` | – | `mock` → her zaman mock |
| `AI_MODEL`, `AI_MODEL_FAST` | `claude-sonnet-5-5`, `claude-haiku-5-5` | |
| `AI_MAX_RETRIES`, `AI_TIMEOUT_MS`, `AI_FALLBACKS`, `AI_ALLOW_BINARY_DOCS` | | `AI_ALLOW_BINARY_DOCS=false` → PDF/görsel modele gitmez (KVKK) |
| `WORKER_INTERVAL_MS`, `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | | |
| `EMAIL_PROVIDER`, `EMAIL_SEND_MODE`, `SMTP_*`, `EMAIL_REPLY_ADDRESS`, `EMAIL_MESSAGE_ID_DOMAIN`, `EMAIL_MAX_ATTEMPTS`, `OUTBOX_DATA_KEY` | `outbox`, `immediate` | gerçek e-posta (SMTP) — [Dağıtım](#e-posta-smtp) |
| `MESSAGING_PROVIDER`, `WHATSAPP_*` | `outbox` | SMS / WhatsApp: yalnız outbox (WhatsApp Cloud API iskeleti canlı değil) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `WEB_PUSH_*` | – | Web Push; anahtar yoksa konsol yedeği |
| `LOG_LEVEL`, `TRUST_PROXY`, `SHUTDOWN_TIMEOUT_MS` | `info`, –, 15000 | JSON log (PII / token redaksiyonu), proxy arkasında gerçek IP, kontrollü kapanış |
| `APP_DB_PASSWORD`, `MIGRATE_ON_START` | – | migrate adımı `mice_app` şifresini ayarlar; container başlarken migration |
| `BACKUP_*` | | `scripts/backup.sh` |

## PRD ilkeleri → kod

| PRD | Nerede |
|---|---|
| §3.1 Tek doğru kaynak, belgeler veriden | `services/documents.ts` (`registerDocumentGenerator`): teklif + kâr-zarar (plan **ve gerçekleşen**, marj ve markup ayrı) `quotes.ts`, müşteri faturası taslağı `closing.ts`, **program** ve **rooming list** `documents-b.ts`; `POST /api/projects/:id/documents` |
| §3.2 Onay kapıları, §15 karar kutusu | `services/decisions.ts`, `registry.ts`, `phase-b-registry.ts`; `@mice/domain` `canDecide`, `requiresBiometric` (ödeme, sözleşme, saha ekstrası, **müşteri teklifi onayı ve marj istisnası** — §15 "para ve sözleşme onaylarında biyometrik doğrulama zorunlu") |
| §3.3 İnsan imzası | `services/drafts.ts` (gönderim yalnız insan / onaylı karar ile), `email.ts` (outbox) |
| §3.5 Değişiklik yayılımı | DB tetikleyicileri `propagate_staleness` / `doc_kinds_for` ↔ `@mice/domain` `DOCUMENT_DEPENDENCIES` (test eşitliği kontrol eder); eski belge gönderilemez |
| §3.6 Silinmez kayıt | `BEFORE DELETE` tetikleyicileri, append-only `audit_log` (proje kodu değişince eski kod denetimde kalır) |
| §3.8 Çok kiracılı | RLS (`tenant_id = app_tenant_id()`), `withTenant`, `apply_standard_policies()` |
| §5 Proje kodu | `@mice/domain` `formatProjectCode`; konaklama / salon teklifi seçilince veya mekân girilince mekân kısmı yenilenir, `PRJ-####` sabit (`items.ts` `syncProjectVenue`) |
| §6 AI yetki sınırları | `@mice/shared` `ai-authority.ts`, `automation.ts` (`aiGate`, `NEVER_AUTO_KINDS`), DB korumaları (para hareketi / kural yazımı yalnız insan) |
| §9 Marj ↔ markup | `@mice/domain` `profitSummary`, `pricing.ts`; arayüzde daima ayrı satır |
| §16 Kendini geliştiren yapı | `automation.ts` sayaçları, terfi / örneklem / geri dönüş; `reports.ts` haftalık rapor |
| §17.9 KVKK | `guests.ts` (pgcrypto, rol bazlı maskeleme, rıza / geri çekme, anonimleştirme); rooming Excel'i canlı üretilir, kişisel veri belgeye kopyalanmaz |

Mühendislik dokümanları: [`docs/README.md`](docs/README.md) — [mimari](docs/01-mimari.md), [veri modeli](docs/02-veri-modeli.md),
[AI yetki matrisi](docs/03-yapay-zeka-yetki-matrisi.md), [doğruluk ölçümü](docs/04-dogruluk-olcumu.md),
[faz 1 planı](docs/05-faz1-teknik-plan.md), [otomasyon terfisi](docs/06-otomasyon-terfisi.md),
[mühendislik cevapları](docs/07-muhendislik-cevaplari.md), [mobil karar](docs/08-mobil-karar.md).

## Testler

```bash
npm run typecheck                               # tüm workspace'ler (tsc --noEmit)
(cd packages/domain && npx vitest run)          # saf iş kuralları
(cd packages/ai && npx vitest run)              # Claude istemcisi (sahte SDK) + mock
(cd apps/api && npx vitest run)                 # entegrasyon: gerçek Postgres `mice_test` (şema her koşuda yeniden kurulur)
(cd apps/web && npx vitest run && npx vite build)
node e2e/steps0-5.mjs && node e2e/steps6-8.mjs   # UI senaryoları (aşağıda)
```

## End-to-end UI senaryoları

`e2e/steps0-5.mjs` ve `e2e/steps6-8.mjs` gerçek arayüzü headless Chromium (Playwright) ile **çalışan** sunuculara karşı sürer:

```bash
bash scripts/db-start.sh && npm run migrate -w apps/api && npm run seed -w apps/api -- --reset
AI_PROVIDER=mock npm start -w apps/api        # :3001
(cd apps/web && npx vite)                      # :5173, /api → :3001
# üretim derlemesine karşı: (cd apps/web && npx vite build && npx vite preview --port 4173) ve BASE_URL=http://localhost:4173
# (headless Face ID başarısız olunca senaryo dev doğrulamasına düşer; docker compose web'i :8080 de aynı şekilde çalışır)
node e2e/steps0-5.mjs                          # BASE_URL=…, SHOTS=<dir> (varsayılan e2e/shots), HEADED=1
node e2e/steps6-8.mjs
```

**Adım 0–5:** satış intake → yönetici mobil karar kutusu (atama) → kalemler / kısa liste / 3 RFQ → `rfq_send` onayı →
tedarikçi linkleri (`POST /api/rfqs/:id/link`) → 3 tedarikçi `/s/rfq/<token>` üzerinden teklif verir → yapıştırılan tedarikçi
e-postası okunur + doğrulanır → karşılaştırma + pazarlık taslağı → teklif seçimi (proje kodunun mekân kısmı güncellenir) →
2 seçenekli teklif (zorlanan marj bloğu, sonra düzeltme) → yönetici onayı (Face ID / dev) → gönderim → müşteri `/q/<token>`
üzerinden kabul (PO) → şablondan sözleşme → karşılaştırma → koşul riski + sözleşme onayı (dev biometrik) → imza → kilit + finans
kayıtları → boş kutu ("Her şey yolunda") → seed projeler, saha paneli, haftalık rapor.

**Adım 6–8:** proje API ile karşılaştırılmış sözleşmeye kadar hazırlanır (fatura bilgisi olmadan → sözleşme temiz değil) →
fatura bilgisi Genel bakış'ta düzeltilir → yeniden karşılaştırma temiz → yönetici onayı (dev biometrik) → imza → imzayla gelen
operasyon görevleri → program belgesi → rooming linki → `/r/<token>` KVKK rıza kutusuyla 2 misafir → misafirler ops için açık,
satış için maskeli + standart rooming Excel indirme → etkinlik günü: saha kullanıcısı mobil panelde "Bugünkü projeler"den
5.000 TL üstü ekstra girer → müşteri `/e/<token>` onaylar → yönetici `field_extra` kararı (dev biometrik) → yansıt / gerekçeyle
yansıtma → finans tedarikçi faturası → ödeme talebi → yönetici onayı (dev biometrik) → "ödendi" → **/finans**'ta banka CSV
içe aktarma otomatik eşleşir + Mikro Excel indirme → müşteri faturası taslağı + Mikro fatura no → tahsilat CSV eşleşir →
kapanış kontrolü → "neyi geç öğrendik?" ile kapanış → anket linki + gerçekleşen kâr-zarar → kontrol listesi önerisi kararı →
`/survey/<token>` → haftalık rapor, yansıtılmayan farklar, markup kademesi düzenleme (geri alınır), vekâlet oluştur / sonlandır →
mobil sekme çubuğu ("Yeni talep", profil menüsünde Finans / Rapor / Yönetim).

Her koşu yeni proje oluşturur (aynı veritabanında tekrar çalıştırılabilir). Beklenmeyen API 5xx/404, sayfa hatası veya
başarısız doğrulamada çıkış kodu 1 + `PROBLEMS` listesi; ekran görüntüleri (deviceScaleFactor 1) `SHOTS` klasörüne yazılır.
Not: mock AI kontrol listesi önerilerini tekrarlamaz; aynı veritabanında ikinci koşuda öneri kartı çıkmayabilir (senaryo bunu
loglar ve atlar).

## Dağıtım (Docker, CI, iletişim kanalları, operasyon)

### Docker Compose (tek sunucu)

```bash
cp .env.example .env      # en az: POSTGRES_PASSWORD, APP_DB_PASSWORD, JWT_SECRET (≥ 32 karakter), GUEST_DATA_KEY,
                          # PUBLIC_BASE_URL / CORS_ORIGIN / WEBAUTHN_ORIGIN / WEBAUTHN_RP_ID (gerçek alan adı), NODE_ENV=production
docker compose up -d --build                  # db → migrate (tek seferlik) → api → web (:8080)
docker compose --profile worker up -d         # + worker (takipler, KVKK, özetler, e-posta yeniden deneme)
docker compose run --rm api seed --reset      # yalnız demo ortamı
```

| Servis | İmaj | Not |
|---|---|---|
| `db` | `postgres:16-alpine` | `pgdata` volume; dışarı açılmaz |
| `migrate` | `apps/api/Dockerfile` → `migrate` | **owner** bağlantısı (`MIGRATION_DATABASE_URL`), migration'lar + `ALTER ROLE mice_app PASSWORD` (`APP_DB_PASSWORD`) |
| `api` | `apps/api/Dockerfile` → `serve` | Node 22 slim, `tsx`, root olmayan `node` kullanıcısı, salt okunur dosya sistemi, `HEALTHCHECK` → `/api/ready`, tini (sinyaller) |
| `worker` | aynı imaj → `worker` | profil `worker`; SIGTERM'de mevcut turu bitirir |
| `web` | `apps/web/Dockerfile` | `vite build` → nginx (unprivileged, :8080): SPA history fallback, `/api` → api, CSP + güvenlik başlıkları, `/assets/*` 1 yıl immutable, `index.html` / `sw.js` / manifest `no-cache` |

**İki bağlantı dizesi (RLS, §3.8):**

| | Rol | Kim kullanır |
|---|---|---|
| `MIGRATION_DATABASE_URL=postgres://postgres:<POSTGRES_PASSWORD>@db:5432/mice` | owner / süper kullanıcı | yalnız `migrate` servisi (ve `seed`, `scripts/backup.sh`) |
| `DATABASE_URL=postgres://mice_app:<APP_DB_PASSWORD>@db:5432/mice` | `mice_app` (NOSUPERUSER, NOBYPASSRLS, DELETE yok) | `api`, `worker` — owner şifresi bu container'lara hiç verilmez |

`mice_app` rolü 001 migration'ında `mice_app` şifresiyle oluşur; `migrate` adımı (`npm run migrate:deploy -w apps/api`,
container'da `migrate`) `APP_DB_PASSWORD` verildiğinde şifreyi değiştirir. Yönetilen PostgreSQL'de aynı adım çalıştırılır
(owner = sağlayıcının yönetici rolü). Tek container kurulumu için `MIGRATE_ON_START=1` `serve` öncesi migration çalıştırır
(o durumda container'a `MIGRATION_DATABASE_URL` da verilmelidir).

TLS, nginx'in önündeki yük dengeleyicide / ingress'te sonlanır (`Strict-Transport-Security` başlığı nginx'te hazır).
API yalnız nginx üzerinden erişilebiliyorsa `TRUST_PROXY=1` (compose varsayılanı) — aksi halde boş bırakın; hız sınırları
gerçek istemci IP'sine göre çalışır.

İmajlar tek başına: `docker build -f apps/api/Dockerfile -t mice-api .` ve `docker build -f apps/web/Dockerfile -t mice-web .`
(bağlam: depo kökü). API imajında `check` aşaması tüm paketlerin `tsc --noEmit` kontrolünü yapar.

### Sağlık, log, kapanış

- `GET /api/health` — canlılık: `{ok, status, db: 'up'|'down', uptimeS}` (her zaman 200).
- `GET /api/ready` — hazırlık: DB yanıt veriyor, imajdaki tüm migration'lar uygulanmış ve kapanış başlamamışsa 200, aksi 503.
- Log: Fastify/pino JSON (`LOG_LEVEL`); `Authorization`, `Cookie`, `X-Device`, `password` / `token` / `email` / `phone` /
  `fullName` alanları `[redacted]`, public link token'ları URL'de `[token]` (`src/logger.ts`). 5xx hatalar `error` seviyesinde
  yığınla loglanır; istek gövdeleri loglanmaz. `X-Request-Id` nginx'ten gelir.
- SIGTERM: `/api/ready` 503 → yeni bağlantı yok → süren istekler biter → havuz kapanır (15 sn sonra zorla çıkış). Worker mevcut
  tenant turunu bitirir.

### E-posta (SMTP)

`EMAIL_PROVIDER=smtp` + `SMTP_HOST/PORT/USER/PASS/SECURE` → `SmtpEmailProvider` (nodemailer, `services/email-smtp.ts`):

- **From her zaman sorumlu kişinin kendi adresidir** (§3.3). SMTP relay'in kullanıcı adına gönderime izni olmalı (Google
  Workspace SMTP relay / M365 "Send As"), alan adı için SPF + DKIM + DMARC. `SMTP_ENVELOPE_FROM` yalnız zarf göndericisini
  (bounce) değiştirir.
- **Yanıtların projeye bağlanması:** `Message-ID: <outbox-id@EMAIL_MESSAGE_ID_DOMAIN>`, aynı projede aynı alıcıya önceki
  mesaja `In-Reply-To` / `References`, `X-MICE-Project: <proje kodu>`; `EMAIL_REPLY_ADDRESS=replies@acenta.com` verilirse
  `Reply-To: replies+prj-0042@acenta.com, <gönderen>` (gelen kutusu işleyicisi `parseProjectReplyTag` ile eşler).
- **Denetim + yeniden deneme:** her mesaj `outbox`'a (tek kullanımlık linkler maskeli) yazılır; durum `queued → sent | failed`,
  `attempts`, `last_error`, `next_attempt_at` (1, 2, 4 … dk, en çok 6 sa; 5xx kalıcı hata yeniden denenmez). Maskesiz gövde
  yalnız teslimata kadar `outbox_payloads`'ta pgcrypto ile şifreli (`OUTBOX_DATA_KEY`, denetim kaydına girmez) tutulur. Worker
  `runOutboxJobs` ile yeniden dener; vazgeçilen mesaj için gönderene + yöneticilere kritik bildirim. `EMAIL_SEND_MODE=queue`
  → istek içinde SMTP'ye hiç gidilmez, worker gönderir.
- Kişi başı OAuth ile "kendi kutusundan" gönderim (Gmail API / Microsoft Graph) için arayüz taslağı: `services/email-oauth.ts`.

### Web Push (§15)

```bash
npm run vapid:generate -w apps/api      # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT → .env (bir kez; değişirse tüm abonelikler düşer)
```

Profil menüsünde **"Bildirimleri aç"** → `POST /api/push/subscribe`; kapatma `POST /api/push/unsubscribe` (kayıt silinmez,
`active=false`). `GET /api/push/vapid-public-key`. Kritik bildirimler anında, rutinler 08:30 / 18:00 özetinde tek push
(`topic` ile önceki özetin yerine geçer). Service worker (`public/sw.js`) `push` + `notificationclick` → karar kutusu.
iPhone / iPad: yalnız **ana ekrana eklenmiş** PWA (iOS 16.4+) — arayüz bunu ipucu olarak gösterir. 404/410 dönen abonelik
pasifleşir; uç noktalar yalnız bilinen push servislerine izinli (`WEB_PUSH_ALLOWED_HOSTS`, SSRF koruması).
`WEB_PUSH_MINIMAL_PAYLOAD=1` → push servisine proje bilgisi gitmez. VAPID yoksa konsol yedeği (bildirimler yine `notifications`'ta).

### SMS / WhatsApp

`MessagingProvider` (`services/messaging.ts`): saha ekstrası müşteri onay linkleri `channel=sms|whatsapp` ile outbox'a yazılır
(link maskeli; saha sorumlusu linki elle de paylaşabilir). WhatsApp Cloud API sağlayıcısı **iskelet** (şablon mesaj gövdesi
`whatsappTemplatePayload`, canlı değil): onaylı şablon `field_extra_approval`, E.164 numara, opt-in, durum webhook'ları gerekli.

### Yedekleme / geri yükleme

```bash
BACKUP_DATABASE_URL=postgres://postgres:…@host:5432/mice BACKUP_DIR=/backups BACKUP_RETENTION_DAYS=14 scripts/backup.sh
#  → /backups/mice-<UTC>.dump (pg_dump custom, sıkıştırılmış) + .sha256, BACKUP_GPG_RECIPIENT ile şifreli; eskiler silinir
RESTORE_DATABASE_URL=postgres://postgres:…@host:5432/mice_restore scripts/restore.sh /backups/mice-<UTC>.dump
APP_DB_PASSWORD=… MIGRATION_DATABASE_URL=…/mice_restore npm run migrate:deploy -w apps/api   # mice_app şifresi + yeni migration'lar
```

Geri yükleme **boş** bir veritabanına, owner rolüyle yapılır (script dolu hedefi reddeder; `mice_app` rolü küme düzeyinde
olduğundan yoksa oluşturulur; RLS politikaları, tetikleyiciler ve `mice_app` yetkileri dökümden gelir). Canlı DB'nin üzerine
yazmayın: yanına geri yükleyin, `/api/ready` ve örnek kayıtlarla doğrulayın, sonra `DATABASE_URL`'i çevirin. Yönetilen
PostgreSQL'de birincil yöntem sağlayıcının PITR'ıdır; mantıksal dökümler ikinci hat. Yedekler şifreli misafir PII içerir
(KVKK): erişim kısıtlı, şifreli depoda, saklama süresiyle. Örnek cron: `15 2 * * * /opt/mice/scripts/backup.sh`.

### CI (`.github/workflows/ci.yml`)

`checks` (npm ci, typecheck, domain / ai / web birim testleri, web build) · `api-integration` (postgres:16 servis
container'ı, `mice_test`) · `e2e` (migrate + seed, `AI_PROVIDER=mock` API + `vite preview`, Chromium yalnız CI'da
`npx playwright install --with-deps chromium`, `e2e/steps0-5.mjs` ve `e2e/steps6-8.mjs`, ekran görüntüleri artefakt) ·
`docker` (iki imajın derlenmesi + `docker compose config`).

## Bilinen sınırlar / sonraki adımlar

- **İletişim kanalları:** SMTP e-posta ve Web Push hazır (yukarıda); kişi başı OAuth (Gmail API / Graph) gönderimi, gelen
  yanıtların otomatik içe alınması ve WhatsApp Cloud API / SMS sağlayıcısı henüz yok (outbox + manuel paylaşım).
- **Mikro aktarım formatı varsayım:** sütunlar ve cari kod şeması (`120.<kısa kod>`, `320.<TEDARİKÇİ>`) muhasebeci / Mikro
  "Excel'den fatura aktarımı" şablonuyla doğrulanmalı (`finance.ts` `mikroExport`).
- **OTA / kanal fiyatı verisi:** kanal fiyatları manuel giriş / seed; otomatik OTA erişimi (lisans, scraping yasakları) açık konu.
- **Banka entegrasyonu:** ekstre dosya yükleme (CSV / XLSX); bankaların açık bankacılık API'leri ve her bankanın CSV varyantı
  için ek ayrıştırıcı testleri gerekli.
- **e-Fatura / e-Arşiv:** müşteri faturası Mikro'da kesilir; sistem yalnız taslak + fatura no kaydı tutar.
- **WebAuthn:** dev doğrulaması demo/e2e içindir; üretimde `ALLOW_DEV_BIOMETRIC` kapalı, gerçek cihaz kaydı gerekli.
- **Tarayıcı tarafı çevrimdışı kuyruk** yalnız saha işlemleri için; tam offline PWA önbelleği yok.
- **Rooming Excel şablonu** yaygın otel formatıdır; zincir otellerin kendi şablonları için eşleme eklenebilir.
- Gerçekleşen kâr-zarar fatura toplamlarından hesaplanır; kısmi faturalarda kalem bazlı dağıtım sonraki iş.
