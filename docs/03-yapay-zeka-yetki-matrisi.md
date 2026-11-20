# 03 — Yapay Zekâ Yetki Matrisi (§19.2)

> PRD karşılığı: §6 (yapay zekâ yetki sınırları), §16.1 (Yasak liste hiçbir koşulda otomatiğe geçmez), §15 (karar kutusu).
> Kod karşılığı: `packages/shared/src/ai-authority.ts` (`AI_ACTIONS`, `aiAuthorityOf`, `isPromotable`), `DECISION_KINDS`, `domain/authority.ts`.

## Okuma kuralları

- **Seviye:** `autonomous` (onaysız), `suggest` (insan onaylar), `forbidden` (yasak). Listede olmayan her işlem `aiAuthorityOf()` tarafından `forbidden` sayılır.
- **Servis / fonksiyon:** `AiService` (`packages/ai`) metodu, domain fonksiyonu (`packages/domain`) ve API uç noktası (`packages/shared/api.ts`).
- **İzin:** AI aktörü (`actor_type='ai'`) her zaman tek bir acentanın bağlamında, RLS altında çalışır. "Onaylayan rol", kararı kimin verebileceğini gösterir (`Decision.requiredRole`; admin her zaman karar verebilir, vekil için bkz. `canDecide`).
- **Onay ekranı:** `DecisionKind`. "—" işareti karar kartı açılmadığı anlamına gelir; çıktı yalnızca ekranda veya kayıtta görünür.
- **Terfi:** §16 otomasyon terfisine uygunluk. Yalnızca `suggest` seviyesindeki işlemler terfi edebilir (`isPromotable`).
- **Güven eşiği:** Varsayılan `aiConfidenceThreshold = 0.8` (acenta kuralı). Eşik altındaki çıktı `low_confidence_review` kartına düşer.

## 1. Otonom (onaysız)

| İşlem (`AiActionType`) | Servis / fonksiyon | Tetikleyen uç nokta / iş | İzin ve kısıt | Onay ekranı | Terfi |
|---|---|---|---|---|---|
| `request_extraction` — Talep ayıklama | `AiService.extractRequest` (sonnet-5-5) → `domain.markLowConfidence`, `findDuplicates`, `rfqMinimumMissing`, `missingFromChecklist`, `formatProjectCode` | `POST /api/intake`, gelen mail/WA webhook'u, `POST /api/assist/voice-command` | Okuma ve proje oluşturma (proje kodu her talepte açılır). Metin takma adlandırılarak gönderilir | — (eşik altı alanlar: `low_confidence_review`, rol: talep sahibi clerk) | Uygulanmaz |
| `document_reading` — Belge okuma | `AiService.parseSupplierOffer`, `parseContract`, `parseInvoice`. Ekstre için deterministik `domain.parseBankCsv` (LLM yok) | `POST /items/:id/offers/parse`, `/contracts/:id/parse`, `/finance/supplier-invoices`, `/finance/bank-statements` | Yalnızca ilgili proje ve kalem bağlamı. Çıktı alan bazlı `fieldConfidence` içerir. Fiyat geçmişine yalnız doğrulanmış veya eşik üstü değerler yazılır | — / `low_confidence_review` | Uygulanmaz |
| `calculation_normalization` — Hesaplama ve normalizasyon | `domain.normalizeOffer`, `detectHiddenCosts`, `toEur`, `profitSummary`, `priceFromCost` (deterministik, LLM yok) | Teklif kaydında ve karşılaştırma ekranında | Saf fonksiyon. Kur kaynağı kaydedilir | — | Uygulanmaz |
| `comparison` — Karşılaştırma | `domain.evaluateOffer`, `channelAdvantage`, `median` | `GET /api/items/:id/comparison` | Veri yoksa `priceClass='unknown'` (§3.7) | — | Uygulanmaz |
| `diff_report` — Fark raporu | `domain.diffContractVsQuote`, `isContractClean`, `conditionRisk`, `changeImpact`, `revisionTargetStep` | `POST /contracts/:id/compare`, `PATCH /projects/:id`, revizyon | Raporu üretir; sonucu kendisi uygulamaz | Rapor kartları: `contract_diff` (ekip düzeltir), `condition_risk` (admin karar verir) | Uygulanmaz |
| `internal_alarm_task` — Alarm ve iç görev | `domain.dueFollowups`, `operationsCalendar`, `closingCheck` → `tasks` | Takip işçisi (worker) | Yalnızca iç kayıt (`tasks`, `project alerts`). Dış iletişim yok | — (eskalasyonlar: `unbilled_payment_escalation`, `closing_overdue`, `low_supplier_score`) | Uygulanmaz |
| `internal_reminder` — Ekibe iç hatırlatma | Worker → push / uygulama içi bildirim / sabah-akşam özeti | Worker | Yalnızca acenta içi kullanıcılara gider | — | Uygulanmaz |
| `draft_generation` — Taslak üretimi | `AiService.draftMessage`, `ask`, `summarizeStyle` → `message_drafts(status='draft')` | Tüm taslak üreten akışlar | Taslak **gönderilemez**. Gönderim, bir `suggest` işleminin onayına bağlıdır | — | Uygulanmaz |
| `shortlist_suggestion` — Kısa liste önerisi | `domain.rankSuppliers` | `GET /api/items/:id/shortlist`, intake ön eşleştirme | Aday tedarikçi `candidate=true` olarak işaretlenir | — | Uygulanmaz |
| `supplier_rfq_reminder` — **Tek dış istisna** | `domain.dueFollowups` → `{type:'supplier_reminder'}` → Giden mesaj geçidi | Worker (24 saat sonra, `rfqReminderHours`) | Üç ön koşul: (1) `rfqs.status='sent'`, yani RFQ insan tarafından onaylanmış; (2) `message_templates` içinde admin onaylı ve aktif şablon sürümü; (3) gönderim RFQ'yu gönderen kullanıcının adresinden. RFQ başına en fazla 1 hatırlatma (`reminder_sent_at`). 48 saatte `call_task` açılır | — (şablon onayı tek seferlik admin kararıdır) | Uygulanmaz |

## 2. Öneri (insan onaylar)

| İşlem | Servis / fonksiyon | Akış | Onaylayan rol | Onay ekranı (`DecisionKind`) | Biyometrik | Terfi |
|---|---|---|---|---|---|---|
| `customer_missing_info_question` — Müşteriye eksik bilgi sorusu | `draftMessage(kind:'missing_info')` + `missingFromChecklist` | Intake → taslak → kartta gönder | `clerk_sales` (proje sahibi). §7 Adım 0: fiyat içermediği için yönetici onayı gerekmez | `outbound_message` | Hayır | Evet |
| `rfq_send` — RFQ gönderimi | `rankSuppliers` + `draftMessage(kind:'rfq')` + `public_tokens` | `POST /items/:id/rfqs` → kart → Giden geçit (kullanıcının adresi) | `clerk_sales`. 3–5 tedarikçi dışı seçim `override_reason` ister | `rfq_send` | Hayır | Evet |
| `negotiation_message` — Pazarlık mesajı | `draftMessage(kind:'negotiation')` + `canNegotiate` + `negotiationDraftViolations` (rakip adı veya fiyatı içeren taslak gönderilemez) | `POST /offers/:id/negotiate` | `clerk_sales`. Acenta kuralıyla admin onayına yükseltilebilir [Ürün kararı] | `negotiation_message` | Hayır | Evet |
| `team_assignment` — Ekip ataması | `domain.suggestAssignee` | Intake sonrası | `admin` / vekil | `assignment` | Hayır | Evet |
| `margin_suggestion` — Marj önerisi | `evaluateOffer.suggestedMarkup`, `markupForAdvantage` | Teklif oluşturucuda varsayılan değer olarak gelir | Teklifi hazırlayan kişi kabul veya değişiklik yapar. **Hedef marj altı** ise yalnızca admin gerekçeyle açar | Teklif içinde. Eşik altı için `margin_override` | `margin_override`: Evet | Evet (yalnızca varsayılanın düzeltmesiz kabulü sayılır) |
| `customer_quote` — Müşteri teklifi | `domain.validateQuote`, `quoteNeedsApproval`, `draftMessage(kind:'quote_cover')`, PDF üretici | `POST /projects/:id/quotes` → `/quotes/:id/send` | Kişi bazlı yetkiye göre (`authorityLevel`): `all_need_approval` ise admin/vekil; `scoped` veya `full` ise kapsam içinde kişinin kendisi | `quote_approval` | Önerilen: Evet (fiyat taahhüdü) [Ürün kararı] | Koşullu, bkz. 06 §5 |
| `option_extension_request` — Opsiyon uzatma talebi | `dueFollowups` → `option_expiry_alarm` → `draftMessage(kind:'option_extension')` | Worker → kart | `clerk_sales` / `clerk_ops` | `outbound_message` | Hayır | Evet |
| `revision_request` — Revizyon talebi | `diffContractVsQuote` → `draftMessage(kind:'revision_request')` | Sözleşme farkı kartının birincil eylemi: "Revizyon talebini gönder" | `clerk_ops` / `clerk_sales` | `contract_diff` (veya `outbound_message`) | Hayır | Evet |
| `checklist_new_question` — Kontrol listesine yeni soru | `AiService.suggestChecklistQuestions` | Kapanış → öneri | **Yalnızca admin** (`ADMIN_ONLY_DECISIONS`) | `checklist_question` | Hayır | Hayır: kural niteliğinde olduğu için önerilir, otomatiğe geçmez [Ürün kararı] |
| `low_confidence_payment_match` — Düşük güvenli fatura–ödeme eşleşmesi | `domain.matchBankTransaction` (eşik altı aday) | Ekstre yükleme | `finance` | `low_confidence_review` | Hayır | Evet |

> **Not:** Yüksek güvenli banka eşleşmesi (`matchBankTransaction` eşik üstü) para hareketi değildir, yalnızca kayıt eşleştirmesidir. `calculation_normalization` / `comparison` kapsamında otonomdur. Ödeme talimatı hiçbir durumda AI'dan çıkmaz.

## 3. Yasak

Bu işlemlerin AI aktörü için **hiçbir kod yolu yoktur**. Ayrıca veritabanı düzeyinde de reddedilirler.

| İşlem | İnsan karşılığı (tek yol) | Onay ekranı | AI'nin yapabileceği | Teknik engel |
|---|---|---|---|---|
| `money_movement` — Para hareketi / ödeme talimatı | Finance ödeme talebi oluşturur (`POST /finance/payment-requests`). Admin veya vekil onaylar. Banka işlemini insan bankada yapar (Faz 1'de banka API'si yok) | `payment_approval` | Vade alarmı, eşleştirme, taslak | `finance_entries` geçiş tetikleyicisi: `approved`/`paid` için `actor_type='user'`, bağlı `payment_approval` kararı ve WebAuthn doğrulaması şart |
| `supplier_confirmation` — Tedarikçiye konfirmasyon | Müşteri onayı + `contract_approval` → kullanıcı `supplier_confirmation` taslağını kendisi gönderir → `reservations` | `contract_approval` | Konfirmasyon **taslağı** (`draft_generation`) | Giden geçit: `kind='supplier_confirmation'` için `approved_by` bir kullanıcı olmalı. Tedarikçi `accredited` değilse blok |
| `contract_signature` — Sözleşme imzası | `POST /contracts/:id/sign`. Yalnızca `can_sign=true` kullanıcı, admin onayından sonra. Islak imza + tarama | `contract_approval` | Fark raporu, kilit kontrolü | `contracts` tetikleyicisi: `signed` geçişi için kullanıcı aktörü, `can_sign` ve temiz fark (`isContractClean`) gerekir |
| `supplier_accreditation` — Tedarikçi akreditasyonu | Admin (vekil **yapamaz**) | `supplier_accreditation` | Performans skoru, düşük skor uyarısı | `suppliers.status → accredited` tetikleyicisi: rol `admin` ve aktör kullanıcı olmalı |
| `rule_change` — Kural / eşik / yetki değişikliği | `PATCH /api/rules`, `PATCH /api/users/:id`. Yalnızca admin | `rule_suggestion` (AI önerisinin kabulü), `automation_promotion` | Kanıtlı öneri (`rule_suggestions`) | `rules`, `users.authority_level`, `automation_counters.mode` güncellemeleri için kullanıcı aktörü ve admin rolü gerekir |
| `record_deletion` — Kayıt silme | Yok. Durum değişikliği kullanılır (iptal/pasif) | — | — | `DELETE` yetkisi yok + `forbid_delete` tetikleyicisi |
| `external_message_unapproved` — Onaysız dış mesaj | Her dış mesaj onaylı bir taslaktan çıkar | `outbound_message`, `rfq_send`, `negotiation_message`, `quote_approval` … | Taslak | Giden mesaj geçidi tek gönderim noktasıdır. `approved_by IS NOT NULL` ve bu kullanıcı insan olmalı; tek istisna `supplier_rfq_reminder` |

## 4. Karar türü → onaylayan → biyometrik özeti

| `DecisionKind` | Kaynak | Onaylayan | Vekil karar verebilir mi? | Face ID |
|---|---|---|---|---|
| `quote_approval` | `customer_quote` | admin (veya yetki seviyesine göre kişi) | Evet | Önerilen |
| `margin_override` | `margin_suggestion`, `changeImpact` | admin | Evet | Evet |
| `contract_diff` | `diff_report` | clerk (düzeltme) | — | Hayır |
| `contract_approval` | Temiz sözleşme | admin | Evet | **Evet** |
| `condition_risk` | `conditionRisk` | admin | Evet | Evet |
| `payment_approval` | Finance talebi | admin | Evet | **Evet** |
| `supplier_accreditation` | Ekip talebi | admin | **Hayır** | Evet |
| `automation_promotion` / `automation_demotion` | 06 | admin | **Hayır** / bilgi kartı | Hayır |
| `audit_sample` | 06 | admin | Evet | Hayır |
| `rule_suggestion` | §16.5 | admin | **Hayır** | Hayır |
| `checklist_question` | `checklist_new_question` | admin | **Hayır** | Hayır |
| `assignment` | `team_assignment` | admin | Evet | Hayır |
| `rfq_send` | `rfq_send` | clerk_sales | — | Hayır |
| `negotiation_message` | `negotiation_message` | clerk_sales | — | Hayır |
| `outbound_message` | Diğer dış mesajlar | Mesajın sahibi | — | Hayır |
| `field_extra` | Limit üstü saha ekstrası (`fieldExtraNeedsAdmin`) | admin | Evet | Evet (para) |
| `low_confidence_review` | Eşik altı AI çıktısı | İlgili rol (clerk/finance) | — | Hayır |
| `unbilled_payment_escalation` | 7 gün açık ödeme | admin | Evet | Hayır |
| `low_supplier_score` | `supplierScore` | admin | Hayır | Hayır |
| `closing_overdue` | +30 gün | admin | Evet | Hayır |

> `domain.requiresBiometric(kind)` fonksiyonu en az şu türler için `true` dönmelidir: `payment_approval`, `contract_approval`, `margin_override`, `condition_risk`, `field_extra`, `supplier_accreditation`. `quote_approval` için acenta kuralıyla açılabilir bir bayrak önerilir.

## 5. Denetlenebilirlik

Her AI işlemi `ai_actions` tablosuna yazılır: `action_type`, `authority`, `mode`, `model`, `prompt_version`, `confidence`, token ve maliyet bilgisi, bağlı `decision_id`. Haftalık rapor (§16.6) ve otomasyon sayaçları (06) bu tablodan beslenir. Bir AI işleminin hangi karara bağlandığı ve kimin onayladığı her zaman tek sorguyla izlenebilir.
