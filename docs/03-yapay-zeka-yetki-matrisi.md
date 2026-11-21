# 03 — Yapay Zekâ Yetki Matrisi (§19.2)

> PRD karşılığı: §6 (yapay zekâ yetki sınırları), §16.1 (Yasak liste hiçbir koşulda otomatiğe geçmez), §15 (karar kutusu).
> Kod karşılığı: `packages/shared/src/ai-authority.ts` (`AI_ACTIONS`, `aiAuthorityOf`, `isPromotable`, `DEFAULT_CONFIDENCE_THRESHOLD`), `packages/shared/src/enums.ts` (`DECISION_KINDS`), `packages/domain/src/authority.ts` (`ADMIN_ONLY_DECISIONS`, `canDecide`, `requiresBiometric`, `roleCan`), `packages/ai/src/authority.ts` (`assertAiMayPerform`, `draftActionFor`), `apps/api/src/services/automation.ts` (`aiGate`, `assertAiMayExecute`, `NEVER_AUTO_KINDS`), `apps/api/src/services/ai-log.ts` (`logAiAction`), DB korumaları `apps/api/src/db/migrations/003_security_and_integrity.sql` ve `004_phase_b.sql`.

## Okuma kuralları

- **Seviye:** `autonomous` (onaysız), `suggest` (insan onaylar), `forbidden` (yasak). Listede olmayan her işlem `aiAuthorityOf()` tarafından `forbidden` sayılır.
- **Servis / fonksiyon:** `AiService` (`packages/ai`) metodu, domain fonksiyonu (`packages/domain`) ve API uç noktası (`apps/api/src/routes/*.ts`; sözleşme `packages/shared/src/api.ts`). Tüm uç noktalar `/api` önekiyle yazılmıştır.
- **İzin:** AI aktörü (`actor_type='ai'`) her zaman tek bir acentanın bağlamında, RLS altında çalışır. "Onaylayan rol", kararın `requiredRole` değeridir. Admin her zaman karar verebilir; `ADMIN_ONLY_DECISIONS` dışındaki kararları aktif vekil de verebilir; aynı role sahip kullanıcı, `requiredRole` admin değilse karar verebilir (`canDecide`).
- **Onay ekranı:** `DecisionKind`. "—" işareti karar kartı açılmadığı anlamına gelir; çıktı yalnızca ekranda veya kayıtta görünür.
- **Terfi:** §16 otomasyon terfisine uygunluk. Yalnızca `suggest` seviyesindeki işlemler terfi edebilir (`isPromotable`) ve yalnızca `aiGate` üzerinden geçenler sayaç tutar. Karar türü `NEVER_AUTO_KINDS` içindeyse sayaç `auto` olsa bile kart açılır.
- **Güven eşiği:** Varsayılan `aiConfidenceThreshold = 0.8` (acenta kuralı). Eşik altındaki çıktı `low_confidence_review` kartına düşer.
- **Biyometrik:** `requiresBiometric(kind)` = `payment_approval`, `contract_approval`, `field_extra`, `quote_approval`, `margin_override`. Kart `decisions.requires_biometric` ile açılır; `POST /api/decisions/:id/decide` onay/düzeltmede WebAuthn step-up doğrular (reddetmede istemez).

## 1. Otonom (onaysız)

| İşlem (`AiActionType`) | Servis / fonksiyon | Tetikleyen uç nokta / iş | İzin ve kısıt | Onay ekranı | Terfi |
|---|---|---|---|---|---|
| `request_extraction` — Talep ayıklama | `AiService.extractRequest` (`AI_MODEL`) → `domain.markLowConfidence`, `findDuplicates`, `rfqMinimumMissing`, `missingFromChecklist`, `suggestAssignee`, `formatProjectCode` | `POST /api/intake`, `POST /api/assist/voice-command` (`interpretCommand` → `create_project`) | Okuma ve proje oluşturma (proje kodu her talepte açılır). Metin regex + hitap kalıplarıyla maskelenerek gönderilir (sınırlar: 07 §2). Gelen mail/WhatsApp webhook'u **henüz yok**; talep yapıştırılarak girilir | — (eşik altı alanlar ekranda işaretlenir) | Uygulanmaz |
| `document_reading` — Belge okuma | `AiService.parseSupplierOffer`, `parseContract`, `parseInvoice`. Excel → CSV metni (`xlsxToCsv`); banka ekstresi için deterministik `domain.parseBankCsv` (LLM yok) | `POST /api/items/:id/offers/parse`, `POST /api/public/rfq/:token/files`, `POST /api/contracts/:id/parse`, `POST /api/finance/supplier-invoices` (multipart); `POST /api/finance/bank-statements` LLM'siz | Yalnızca ilgili proje ve kalem bağlamı. Çıktı alan bazlı `fieldConfidence` içerir. PDF/görsel maskelenemez, `AI_ALLOW_BINARY_DOCS=false` ile modele gönderimi kapatılabilir | — / `low_confidence_review` (teklif: `clerk_sales`) | Uygulanmaz |
| `calculation_normalization` — Hesaplama ve normalizasyon | `domain.normalizeOffer` (içinde `detectHiddenCosts`), `toEur`, `profitSummary` (deterministik, LLM yok) | Teklif kaydında ve karşılaştırma ekranında | Saf fonksiyon. Kur kaynağı ve tarihi kaydedilir | — | Uygulanmaz |
| `comparison` — Karşılaştırma | `domain.evaluateOffer` (içinde `channelAdvantage`, `median`), `markupForAdvantage` | `GET /api/items/:id/comparison` | Veri yoksa `priceClass='unknown'` (§3.7) | — | Uygulanmaz |
| `diff_report` — Fark raporu | `domain.diffContractVsQuote`, `isContractClean`, `conditionRisk`, `changeImpact`, `revisionTargetStep`; müşteri revizyonunda `extractRequest` | `POST /api/contracts/:id/compare`, `PATCH /api/items/:id` (değişiklik akışı), `POST /api/public/quotes/:token/revision` | Raporu üretir; sonucu kendisi uygulamaz | Rapor kartları: `contract_diff` (revizyon taslağıyla), `condition_risk` (admin) | Uygulanmaz |
| `internal_alarm_task` — Alarm ve iç görev | `domain.dueFollowups`, `operationsCalendar`, `closingCheck` → `tasks` | İşçi (`worker.ts`), sözleşme imzası | Yalnızca iç kayıt (`tasks`, proje uyarıları). Dış iletişim yok | — (eskalasyonlar: `unbilled_payment_escalation`, `closing_overdue`, `low_supplier_score`) | Uygulanmaz |
| `internal_reminder` — Ekibe iç hatırlatma | `NotificationService.deliver` (`services/notifications.ts`) → `notifications`; kritik anında, rutin 08:30 / 18:00 özetinde | İşçi, karar oluşturma (`onDecisionCreated`) | Yalnızca acenta içi kullanıcılara gider. VAPID anahtarı verilirse Web Push (`services/push.ts`), aksi halde konsol uygulaması | — | Uygulanmaz |
| `draft_generation` — Taslak üretimi | `AiService.draftMessage`, `ask`, `summarizeStyle` → `message_drafts` | Tüm taslak üreten akışlar (`aiDraft`, `services/drafts.ts`) | Taslak AI tarafından **gönderilemez**. Onay gerektiren taslak `pending_approval` açılır; gönderim bir `suggest` işleminin onayına veya clerk'in kendi gönderimine bağlıdır | — | Uygulanmaz |
| `shortlist_suggestion` — Kısa liste önerisi | `domain.rankSuppliers` | `GET /api/items/:id/shortlist`, intake ön eşleştirme | Aday (`candidate`) tedarikçi işaretlenir; aday tedarikçi teklifi bloklar | — | Uygulanmaz |
| `supplier_rfq_reminder` — **Tek dış istisna** | `domain.dueFollowups` → `{type:'supplier_reminder'}` → `EmailProvider` | İşçi (24 saat sonra, `rfqReminderHours`) | Ön koşullar: (1) `rfqs.status='sent'`, yani RFQ insan tarafından onaylanmış; (2) metin kodda sabit, dil bazlı şablondur (`worker.ts` `RFQ_REMINDER_TEMPLATE`), AI üretmez ve yeni link içermez; (3) RFQ'yu gönderen kullanıcının adresinden. RFQ başına en fazla 1 hatırlatma (`reminder_sent_at`); `outbox.autonomous=true`. 48 saatte `call_supplier` görevi açılır | — (şablon kod incelemesiyle onaylanır; acentanın düzenleyebileceği şablon tablosu henüz yok [Ürün kararı]) | Uygulanmaz |

## 2. Öneri (insan onaylar)

| İşlem | Servis / fonksiyon | Akış | Onaylayan rol (`requiredRole`) | Onay ekranı (`DecisionKind`) | Biyometrik | Terfi |
|---|---|---|---|---|---|---|
| `customer_missing_info_question` — Müşteriye eksik bilgi sorusu | `draftMessage(kind:'missing_info')` + `missingFromChecklist` | Intake → taslak (`requires_approval=false`) → clerk `POST /api/drafts/:id/send` ile gönderir; isterse `POST /api/drafts/:id/request-approval` | Proje sahibi clerk. §7 Adım 0: fiyat içermediği için yönetici onayı gerekmez | Yok; onaya yollanırsa `outbound_message` (admin) | Hayır | Sayaç yok (`aiGate`'ten geçmez) |
| `rfq_send` — RFQ gönderimi | `rankSuppliers` + `draftMessage(kind:'rfq')` + tek kullanımlık token | `POST /api/items/:id/rfqs` → `aiGate` → kart → Giden geçit (kullanıcının adresi) | `clerk_sales`. 3–5 tedarikçi dışı seçim `overrideReason` ister | `rfq_send` | Hayır | Evet |
| `negotiation_message` — Pazarlık mesajı | `draftMessage(kind:'negotiation')` + `canNegotiate` + `negotiationDraftViolations` (rakip adı veya fiyatı içeren taslak gönderilemez; ihlal şüphesinde `forceApproval`) | `POST /api/offers/:id/negotiate` → `negotiation_rounds` | `admin` (veya vekil). İlk taslakta `clerk_sales` önerilmişti; uygulama admin seçti [Ürün kararı] | `negotiation_message` | Hayır | Evet (ihlal varsa her zaman kart) |
| `team_assignment` — Ekip ataması | `domain.suggestAssignee` | Intake sonrası `aiGate` | `admin` / vekil | `assignment` | Hayır | Evet |
| `margin_suggestion` — Marj önerisi | `evaluateOffer` sonucu + `markupForAdvantage` | Teklif oluşturucuda varsayılan değer; `ai_actions`'a kaydedilir | Teklifi hazırlayan kişi kabul eder veya değiştirir. **Hedef marj altı** teklif `blocked` olur; yalnızca admin gerekçeyle açar | Teklif içinde. Hedef altı için `margin_override` | `margin_override`: Evet | Sayaç yok (`margin_override` `NEVER_AUTO_KINDS` içinde) |
| `customer_quote` — Müşteri teklifi | `domain.validateQuote`, `quoteNeedsApproval`, `draftMessage(kind:'quote_cover')`, PDF üretici | `POST /api/projects/:id/quotes` → `aiGate` → `POST /api/quotes/:id/send` | `admin` / vekil, kişi bazlı yetkiye göre (`authorityLevel`): `all_need_approval` ise kart açılır; `scoped` (kapsam içi) veya `full` ise kart açılmaz, kişi kendisi gönderir | `quote_approval` | **Evet** (fiyat taahhüdü; §15) | Koşullu, bkz. 06 §5 |
| `option_extension_request` — Opsiyon uzatma talebi | `dueFollowups` → `option_expiry_alarm` → `draftMessage(kind:'option_extension')` | İşçi → `aiGate` → kart | `clerk_sales` | `outbound_message` | Hayır | Evet |
| `revision_request` — Revizyon talebi | `diffContractVsQuote` → `draftMessage(kind:'revision_request')` | `POST /api/contracts/:id/compare` → `aiGate`; kartın birincil eylemi revizyon talebini göndermek | `admin` / vekil | `contract_diff` | Hayır | Sayaç tutulur, ama `contract_diff` `NEVER_AUTO_KINDS` içinde olduğundan otomatiğe geçmez |
| `checklist_new_question` — Kontrol listesine yeni soru | `AiService.suggestChecklistQuestions` | `POST /api/projects/:id/close` → `aiGate` | **Yalnızca admin** (`ADMIN_ONLY_DECISIONS`) | `checklist_question` | Hayır | Teknik olarak terfi edilebilir; kural niteliğinde olduğu için önerilmez [Ürün kararı] |
| `low_confidence_payment_match` — Düşük güvenli fatura–ödeme eşleşmesi | `domain.matchBankTransaction` (0,3 ≤ güven < eşik) | `POST /api/finance/bank-statements` → `aiGate` | `finance` | `low_confidence_review` (`entityType='bank_transaction'`; Düzelt `{entryId}`) | Hayır | Evet |

> **Not:** Yüksek güvenli banka eşleşmesi (`matchBankTransaction` ≥ eşik) para hareketi değildir, yalnızca kayıt eşleştirmesidir ve otonomdur. Ödeme talimatı hiçbir durumda AI'dan çıkmaz.

## 3. Yasak

Bu işlemlerin AI aktörü için **hiçbir kod yolu yoktur** (`aiGate` ve `assertAiMayExecute` reddeder, `403 AI_FORBIDDEN_ACTION`). Kritik olanlar ayrıca veritabanı düzeyinde de reddedilir (`MI006` → `403 FORBIDDEN_FOR_ACTOR`).

| İşlem | İnsan karşılığı (tek yol) | Onay ekranı | AI'nin yapabileceği | Teknik engel |
|---|---|---|---|---|
| `money_movement` — Para hareketi / ödeme talimatı | Finance ödeme talebi oluşturur (`POST /api/finance/payment-requests`). Admin veya vekil onaylar (her ödeme ayrı). Banka işlemini insan bankada yapar ve `POST /api/finance/entries/:id/mark-paid` ile kaydeder (banka API'si yok) | `payment_approval` (Face ID) | Vade alarmı, eşleştirme, taslak | Uygulama: karar etkisi yalnızca `approved` yapar; AI/otomatik yürütme etki içinde, `NEVER_AUTO_KINDS`'ta reddedilir. DB: **`finance_money_guard`** — `approved`/`paid` geçişi yalnızca `actor_type='user'` |
| `supplier_confirmation` — Tedarikçiye konfirmasyon | İmza sonrası `supplier_confirmation` taslağı açılır; `confirm_supplier` yetkili insan gönderir → `reservations` `confirmed` | `contract_approval` (öncül) | Konfirmasyon **taslağı** (`draft_generation`) | Giden geçit: `supplier_confirmation` türünü yalnızca `roleCan('confirm_supplier')` gönderir; imza için tedarikçi `accredited` olmalı |
| `contract_signature` — Sözleşme imzası | `POST /api/contracts/:id/sign`. Yalnızca admin / `can_sign` / `signatory`; sözleşme `approved` (temiz + admin onayı), koşul riski kabul edilmiş, tedarikçi akredite olmalı. Islak imza + tarama | `contract_approval` (Face ID) | Fark raporu, kilit kontrolü | Uygulama: `signContract` AI aktörüyle `assertAiMayExecute('contract_signature')`. DB: **`contract_sign_guard`** (`signed` yalnızca `actor_type='user'`), **`contract_lock`** (kilitli sözleşmede yalnızca `signed→amended`, `superseded_by`; değişiklik `POST /api/contracts/:id/amend` ek protokol satırıdır) |
| `supplier_accreditation` — Tedarikçi akreditasyonu | `PATCH /api/suppliers/:id` (`status:'accredited'`) → karar; yalnızca admin karar verir (vekil **veremez**) | `supplier_accreditation` | Performans skoru, düşük skor uyarısı | DB: **`supplier_accreditation_guard`** — AI/tedarikçi/müşteri aktörü `accredited` yapamaz; CHECK `accredited ⇒ accredited_by`. Admin rolü kontrolü uygulama katmanında (`ADMIN_ONLY_DECISIONS`) |
| `rule_change` — Kural / eşik / yetki değişikliği | `PATCH /api/rules` (admin + insan aktör; anahtarlar `DEFAULT_RULES`'a göre doğrulanır, sürümlü), `PATCH /api/users/:id` (admin; kendi yetkisini düşüremez). Otomasyon terfisi `automation_promotion` kararıyla | `rule_suggestion` (kart türü ve etkisi var; öneri üreticisi henüz yok), `automation_promotion` | Kanıtlı öneri (`rule_suggestions`) | DB: **`rules_change_guard`** — `actor_type='ai'` iken `rules` tablosuna yazılamaz. `users.authority_level` ve `automation_counters.mode` için kontrol uygulama katmanındadır (admin rotaları, `promoteAction` yalnız `isPromotable`) |
| `record_deletion` — Kayıt silme | Yok. Durum değişikliği kullanılır (iptal/pasif/sonlandır) | — | — | `mice_app` rolünde `DELETE`/`TRUNCATE` yetkisi yok + `forbid_delete` tetikleyicisi (`MI001`) |
| `external_message_unapproved` — Onaysız dış mesaj | Her dış mesaj insan kullanıcının gönderdiği veya onayladığı bir taslaktan çıkar | `outbound_message`, `rfq_send`, `negotiation_message`, `contract_diff` … | Taslak | Giden mesaj geçidi (`sendDraft`) tek gönderim noktasıdır; `requires_approval` taslak onaysız `DRAFT_NOT_APPROVED`. Tek istisna `supplier_rfq_reminder` |

Diğer DB korumaları: **eski belge gönderim koruması** (`documents_send_guard`: `stale` belge `sent_at` alamaz) ve **teklif gönderim koruması** (`quotes_send_guard`: onaysız veya belgesi güncel olmayan teklif `sent` olamaz) — `409 DOCUMENT_STALE` / `QUOTE_NOT_APPROVED`.

## 4. Karar türü → onaylayan → biyometrik özeti

Kaynak: servislerdeki `createDecision` / `aiGate` çağrılarının `requiredRole` değerleri; vekil sütunu `canDecide` kuralından türetilmiştir.

| `DecisionKind` | Kaynak | Onaylayan (`requiredRole`) | Vekil karar verebilir mi? | Face ID (`requiresBiometric`) |
|---|---|---|---|---|
| `quote_approval` | `customer_quote` | admin | Evet | **Evet** |
| `margin_override` | Hedef marj altı teklif | admin | Evet | **Evet** |
| `contract_diff` | `revision_request` / fark raporu | admin | Evet | Hayır |
| `contract_approval` | Temiz sözleşme | admin | Evet | **Evet** |
| `condition_risk` | `conditionRisk`; değişiklik akışında marj hedef altı | admin | Evet | Hayır (kabul edilmeden imza yok) |
| `payment_approval` | Finance talebi | admin | Evet | **Evet** |
| `supplier_accreditation` | `PATCH /api/suppliers/:id` | admin | **Hayır** | Hayır |
| `automation_promotion` / `automation_demotion` | 06 | admin | **Hayır** / Evet (bilgi kartı) | Hayır |
| `audit_sample` | 06 | admin | Evet | Hayır |
| `rule_suggestion` | §16.5 (üretici henüz yok) | admin | **Hayır** | Hayır |
| `checklist_question` | `checklist_new_question` | admin | **Hayır** | Hayır |
| `assignment` | `team_assignment` | admin | Evet | Hayır |
| `rfq_send` | `rfq_send` | clerk_sales | Evet | Hayır |
| `negotiation_message` | `negotiation_message` | admin | Evet | Hayır |
| `outbound_message` | Teklif takibi, opsiyon uzatma (clerk_sales); elle onaya yollanan taslak (admin) | clerk_sales / admin | Evet | Hayır |
| `field_extra` | Limit üstü saha ekstrası (`fieldExtraNeedsAdmin`) | admin | Evet | **Evet** |
| `low_confidence_review` | Eşik altı teklif okuma (clerk_sales), banka eşleşmesi (finance) | clerk_sales / finance | Evet | Hayır |
| `unbilled_payment_escalation` | `unbilledPaymentEscalationDays` gün açık ödeme | admin | Evet | Hayır |
| `low_supplier_score` | `supplierScore` < `lowSupplierScore` | admin | Evet | Hayır |
| `closing_overdue` | Etkinlik bitişi + 30 gün | admin | Evet | Hayır |

> `domain.requiresBiometric(kind)` bugün şu türler için `true` döner: `payment_approval`, `contract_approval`, `field_extra`, `quote_approval`, `margin_override` (§15: gönderilen müşteri teklifi bir para taahhüdüdür). İlk taslaktaki `condition_risk` ve `supplier_accreditation` için Face ID önerisi uygulanmadı; gerekirse `BIOMETRIC` kümesine eklenmesi [Ürün kararı].

## 5. Denetlenebilirlik

Her AI işlemi `logAiAction()` ile `ai_actions` tablosuna yazılır: `action_type`, `authority`, `mode` (`autonomous`/`approval`/`auto`/`blocked`), `model`, `confidence`, `input_summary`, `output`, `tokens` (jsonb: input/output/cacheRead/cacheWrite), bağlı `entity_type/entity_id`, `decision_id`, `sampled`, `outcome` ve düzeltme alanları (`corrected`, `correction`, `corrected_by`, `corrected_at`). İstem sürümü ve maliyet alanı henüz yoktur. Haftalık rapor (§16.6) ve otomasyon sayaçları (06) bu tablodan ve `automation_events`'ten beslenir. Bir AI işleminin hangi karara bağlandığı ve kimin onayladığı (`decisions.decided_by`, `decided_device`, `via_delegation`, `biometric_method`, `webauthn_credential_id`) tek sorguyla izlenebilir.
