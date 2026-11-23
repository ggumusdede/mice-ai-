# v0.5 — Ürün sahibi kararları (uzman paneli anketi, 22.11.2026)

Kaynak: [11-uzman-paneli.md](11-uzman-paneli.md) soruları S-01…S-26 + geliştirme soruları. "Panel önerisi" = kabul edilen öneri.

| # | Konu | Karar | Not / etkisi |
|---|---|---|---|
| S-01 | Otomatik dış mesaj | **Hızlı onay** (tek dokunuş, toplu kart, nöbetçi, eskalasyon); otomatik dış mesaj yok | Ana çatı 6 korunur |
| S-02 | Kurumsal WhatsApp/SMS | **Evet, şartlı**: sohbet bir kişiye atanmış, onaylayanın adı mesajda ve kayıtta; katılımcıya mesaj varsayılan kapalı | |
| S-03 | Tedarik derinliği | **Çekirdek**: kontrat fiyatı, allotment, release/attrition, opsiyon 1./2. sıra | Tam modül sonra |
| S-04 | Hedef segment | **Kongre de tam** (PCO dahil): kongre kayıt, yaka kartı, abstract v0.5 kapsamında | ⚠ Panel önerisinden büyük; kapsam ve süre artar |
| S-05 | Barındırma | **AB varsayılan + Kurumsal'da TR seçeneği** | [Doğrulanmalı] avukat |
| S-06 | Kapora önce | **Uyar + gerekçe + Face ID istisna**; acenta blok seçebilir | |
| S-07 | Teklif kur politikası | **Zorunlu alan, kur payı müşteriye gizli** (istenirse madde olarak) | |
| S-08 | Müşteri adı gizleme istisnası | **Açılabilir**: müşteri bazında, anlaşmalı oteller için, yönetici kararı, geri alınabilir | |
| S-09 | Kişisel hesaplar | **Kurumsal varsayılan, yönetici istisna verebilir**; kişisel WhatsApp yalnız "Projeye ilet" | |
| S-10 | Ekip sıralaması | **Yalnız yönetici görür** (isimli sıralama); çalışan sıralamayı görmez | |
| S-11 | Satış primi | **Acenta tercihine bağlı (opsiyonel ayar)**; açan acentada satışçı tahmini primini görür | Kural: `showEstimatedBonus` varsayılan kapalı |
| S-12 | Tedarikçiye söz skoru | **Acenta/proje düzeyi**, kişi sıralamasına girmez | |
| S-13 | Meşgul vekâleti | **Son tarihli kartlar vekile yönlenir**; otomatik onay asla yok | |
| S-14 | Mesai dışı bildirim | **Her zaman (acenta varsayılanı)**; acenta/çalışan isterse sessiz saat açabilir | |
| S-15 | Çevrimdışı PII | **Ad + oda + transfer grubu + telefon**, rol bazlı, şifreli, uzaktan iptal | |
| S-16 | Uçak bileti | **İkisi de**: IATA'lı acenta sistemden (GDS/NDC) bilet keser; IATA'sız acenta bilet acentası üzerinden yürütür (talep/takip/fatura) | ⚠ Panel önerisinden büyük; GDS entegrasyonu + lisans |
| S-17 | Müşteri faturası | **Şimdilik muhasebe programı**; sistemden kesim v0.7+ isteğe bağlı | |
| S-18 | Muhasebe sırası | **Mikro (v0.5 doğrulama) → genel CSV (v0.6) → anketle 2. program** | |
| S-19 | Para birimi | **Acenta seçer (TL/EUR/USD) ve değiştirebilir**; yeni projelere uygulanır | ⚠ **Ana çatı 7 değişti** (CLAUDE.md güncellendi) |
| S-20 | Açık kitap fiyatlama | **v0.6**, komisyonlar yalnız beyan | |
| S-21 | SaaS fiyat | **Kullanıcı bandı + AI kredisi** | Fiyatlar [Doğrulanmalı] |
| S-22 | Ayrılan acentanın verisi | **90 gün salt okunur + dışa aktarım → kripto silme/anonimleştirme**; ek: ücretli **salt okunur arşiv aboneliği** (bağlılık değerle sağlanır, veri rehin tutulmaz) | [Doğrulanmalı] avukat (KVKK, veri işleyen) |
| S-23 | Dönem kilidi | **v0.6, düzeltme belgesiyle** | |
| S-24 | Acentalar arası kıyas | **Önce hukuki görüş** (4054 + KVKK); uygunsa v0.7, açık onay + toplu anonim veri | |
| S-25 | Ses | **Varsayılan kapalı**, v0.6'da sunucu tarafı STT | |
| S-26 | 17 temkinli varsayılan | **Paket onay** | 11-uzman-paneli.md |
| D-1 | Kabul edilmiş teklif revizyonu | **Revize edilebilir** (Rev.N, müşteri yeniden onaylar); sözleşme varsa ek protokol akışıyla bağlanır | Mevcut 409 `QUOTE_ACCEPTED` kaldırıldı (uygulandı) |
| D-2 | Teklif kalitesi metrikleri | **Teklifi hazırlayan + onun küçük çekirdek ekibi** | Yeni "ekip (alt takım)" kavramı |
| D-3 | İlk yüklemede satış sorumlusu | **Evet**, isteğe bağlı sütun, kullanıcıyla eşleştirme | |

| M-1 | Mobil | **Mağaza uygulaması**: mevcut web uygulaması Capacitor ile iOS/Android'e sarılır, App Store / Google Play'e konur (yerel Face ID, APNs/FCM bildirim, güçlü çevrimdışı). v0.5-A'dan sonra. Apple/Google geliştirici hesabı gerekir | 23.11.2026; docs/08 güncellenecek; ana çatı 1'e `apps/mobile` eklendi |

| L-1 | Diller | **TR + EN (v0.6), sonra RU**: ekranlar, teklif PDF'i, müşteri/tedarikçi link sayfaları; yazışma taslakları ve belge okuma zaten TR/EN/RU | 23.11.2026; i18n altyapısı hazır (`apps/web/src/i18n`) |

## Kapsam etkisi
Panelin v0.5 tahmini (≈95–110 geliştirici-haftası) üç büyütmeyle artar: S-04 tam kongre (+≈15–25), S-16 GDS ile bilet kesimi (+≈15–20, lisans/sertifikasyon süresi hariç), S-19 acenta para birimi (+≈4–6). Önerilen sıralama `docs/11` §v0.5 tablosunda güncellenecek; GDS ve kongre kaydı için ayrı alt fazlar (v0.5-A çekirdek, v0.5-B kongre, v0.5-C bilet) önerilir.

## Uygulama — v0.5-A "Ekip, iletişim ve kontrol"

Migration `020_team_communication_control.sql` (yeni tablolar: `teams`, `on_call_shifts`, `customer_supplier_disclosures`,
`handovers`, `handover_reads`, `project_field_staff`, `field_packs` — hepsi `apply_standard_policies` + kiracı FK; diğerleri eklemeli
sütun). Sözleşme: `packages/shared/src/team.ts`; saf kurallar: `packages/domain/src/team-control.ts`; API: `routes/team.ts`,
`services/{team-control,handover,field-pack,customer-relations,team-reports}.ts`. Senaryolar `EK-01…EK-14`, e2e 19–21.

| # | Uygulama | Durum |
|---|---|---|
| S-01 | Dış mesaj kartlarında tek dokunuş ("Tek dokunuşla gönder"), 2+ kartta toplu kart ("N mesaj onay bekliyor — Hepsini onayla / Tek tek bak", `POST /api/decisions/batch-approve`: her kart ayrı karar + ayrı denetim izi, Face ID kartı girmez); nöbet çizelgesi (`/yonetim/ekip`), mesai dışı kart nöbetçiye atanır, `quickApprovalEscalationMinutes` (10) sonra nöbetçi → vekili → yönetici; hazır şablonlar (talebiniz alındı, gecikme/rötar, kriz, ödeme hatırlatması, opsiyon bırakma) → proje sayfasında "Hazır mesaj"; vadesi geçen fatura için worker hatırlatma kartı (`collectionReminderAfterDays`). Otomatik dış mesaj yok | ✅ |
| S-02 | WhatsApp/SMS taslağı yalnız kişiye atanmış sohbetten (`from_user_id`) gider (409 `CONVERSATION_UNASSIGNED`); onaylayanın adı mesaja eklenir ve `message_drafts.signed_by_name`'de; katılımcıya mesaj `participantMessagingDefault='off'`, proje bazında müşteri izniyle (gerekçe zorunlu) lojistik/açık | ✅ |
| S-08 | Müşteri × tedarikçi istisnası (yalnız yönetici, gerekçe zorunlu, geri alınabilir); `supplierRef(ctx, code, supplierId)` istisnalı otele tam kod, diğerlerine güvenli referans (RFQ, portal, hatırlatma, opsiyon uzatma) | ✅ (sözleşme / rooming / pazarlık çağrıları henüz `supplierId` geçmiyor → güvenli referans kalır) |
| S-09 | Posta kutusu bağlarken kurumsal alan adı denetimi (`corporateMailDomains`, kişisel sağlayıcılar engelli, 403 `PERSONAL_ACCOUNT_BLOCKED`), kişi bazlı yönetici istisnası; "Projeye ilet" (proje sayfası + PWA share target `/ilet`) | ✅ |
| S-10 | İsimli rapor yalnız yönetici; "Benim panom" (`/benim`, `GET /api/me/performance`) yalnız kendi rakamları | ✅ |
| S-11 | `showEstimatedBonus` (vars. kapalı) + `bonusFormula` (oran × tahsil edilmiş / gerçekleşen / planlanan kâr), açıklama metniyle | ✅ [Doğrulanmalı: İK/hukuk] |
| S-12 | Söz tutma skoru acenta + proje düzeyinde (`GET /api/reports/promise-keeping`): vadesi gelen tedarikçi ödemelerinden ödenenler + son tarihten önce ele alınan opsiyon kartları | ✅ (ödeme "zamanında" yerine "ödenmiş" sayılır — ödeme tarihi alanı yok) |
| S-13 | Son tarihli kart (`decisions.deadline_at`; yoksa detaydaki `optionUntil / ticketTimeLimit / releaseDate …`) bekleme + yaklaşma süresinde önce onaylayana kritik bildirim, ≥30 dk sonra kişinin meşgul vekiline (`users.deputy_user_id`); vekil karar verir (Face ID kapıları aynen), otomatik onay yok | ✅ |
| S-14 | Varsayılan "her zaman"; `quietHours` acenta + kişi (`/benim`) — rutin özetler pencere sonuna kalır, kritikler geçer | ✅ |
| S-15 | `POST /api/field/packs`: ad + oda + transfer grubu + telefon; saha kullanıcısı projede gruba atanmışsa yalnız o grup; anahtar bir kez döner (sunucuda yalnız özeti), cihazda AES-GCM + dışa aktarılamaz anahtar (IndexedDB); uzaktan iptal + süre (`fieldPackValidHours`); çevrimdışı kuyruk onay yollarını reddeder | ✅ [Doğrulanmalı: aydınlatma metni] |
| S-25 | `voiceFeaturesEnabled=false`; ses düğmesi kapalıyken görünmez | ✅ |
| S-26 | 17 madde kural olarak (`DEFAULT_RULES`), Kurallar → "Ürün kararları (v0.5)" altında gruplu ve kapalı; v0.6 işlerinin maddeleri yalnız varsayılan | ✅ (davranışı olan: #8, #10 kısmen; diğerleri ilgili özellik gelince okunur) |
| D-2 | Ekipler (`/yonetim/ekip`), lider; ekip performansı raporunda ekip satırları (teklif kalitesi yazar + ekip), lider `GET /api/reports/my-team-performance` (alfabetik, sırasız) | ✅ |
| D-3 | İlk yüklemede isteğe bağlı "Satış sorumlusu" sütunu (e-posta veya ad; eşleşmezse uyarı `SALES_OWNER_NOT_FOUND`/`AMBIGUOUS`) | ✅ |
| K-04/K-05 | Müşteride ilişki sahibi + yedek irtibat (`requireBackupContact`); devir-teslim (`/yonetim/devir`, `/devir/:id`): veriden paket, planlı (worker) / acil (Face ID) erişim kapatma (oturum, vekâlet, nöbet, posta jetonu, push, saha paketi), iş devri, "okudum" takibi; "Sistem neyi ölçer / ölçmez" sayfası (`/olcum`) | ✅ (AI destekli bilgi aktarım görüşmesi v0.6) |

## Uygulama — v0.5-A "Para ve tedarik çekirdeği"

Migration `019_base_currency_procurement.sql`; kod: `packages/domain/src/{base-currency,procurement,money-controls}.ts`,
`apps/api/src/services/{settings,procurement}.ts`, `routes/procurement.ts`; arayüz: Kurallar → "Ana para birimi" (`MoneyRules.tsx`),
proje → Teklifler sekmesi altında "Tedarikçi opsiyonları" + "Grup blokesi" (`ProcurementPanel.tsx`), Tedarikçiler → "Kontrat fiyatları",
teklif oluşturucuda katlanmış "Kur politikası", finans satırında "kapora önce" gerekçesi. Senaryolar: `docs/10` M-01…M-08.

| # | Uygulama | Durum |
|---|---|---|
| S-19 | `tenants.base_currency` (EUR / TRY / USD; mevcut acentalar EUR). Değişiklik: yalnız yönetici, gerekçe + **Face ID** karar kartı (`base_currency_change`, yalnız yönetici, AI yasak listesinde), audit. Proje oluşurken acentanın o anki para birimini alır (`projects.base_currency`, DB tetikleyicisi; sonradan değiştirilemez — `MI019`). Projenin tüm hesapları (normalizasyon, değerlendirme, teklif, marj/markup, P&L, kapanış, finans `amount_base`, gerçekleşen kâr `RealizedFx.base`) projenin para biriminde; kurlar mevcut tarihli tablodan (1 EUR = x) proje para birimine çevrilerek. Yeni kolonlar `*_base` + `base_currency`; eski `*_eur` kolonları kaldırılmadı, **EUR karşılığıyla dolmaya devam eder** (kullanımdan kalkıyor; EUR acentada = base). API alan adları (`*Eur`) uyumluluk için korundu: değerleri projenin ana para birimindedir (`baseCurrency` alanı eklendi). Acenta düzeyi raporlar (ekip performansı, haftalık rapor, yansıtılmayan farklar) acentanın **bugünkü** ana para birimine çevrilir, kur kaynağı `fxNote`'ta. Fiyat geçmişi / kanal fiyatı acenta geneli kıyas verisi olarak EUR'da saklanır, kıyasta proje para birimine çevrilir | ✅ |
| S-03 / K-11 | Kontrat fiyatı (`contract_rates`: tedarikçi × hizmet × oda tipi/pansiyon × geçerlilik, fiyat, para birimi, KDV dahil mi, koşullar; silinmez → arşiv). Kıyasta çıpa: değerlendirmede `contractBenchmark` ("Kontrat fiyatı"), kontratın üstündeki teklif risk satırı alır, kanal/geçmiş verisi yoksa fiyat sınıfını kontrat belirler | ✅ (dinamik BAR−%x, hacim taahhüdü v0.6) |
| S-03 / K-12 | Allotment (`allotment_blocks`): gecelik oda, release tarihi, attrition %, ceza %, isimsiz pickup, release geçmişi. Saf fonksiyonlar: `attritionPenalty`, `allotmentSummary`, `needsReleaseCard`. T-x (`allotmentReleaseWarningDays`, vars. 7) "release et / tut" kartı tahmini cezayla; karar insanın, release kaydı + tedarikçi bildirimi **onaylı taslak**; otomatik release yok (`allotment_release` AI yasak listesinde) | ✅ (çok otelli blok, sub-block v0.6+) |
| S-03 / K-13 | Opsiyon (`supplier_options`): 1./2. opsiyon sırası (2. opsiyon uyarısı), T-3 (`supplierOptionWarningDays`) "uzat / bırak / konfirme et" kartı → uzatma talebi taslağı insan onayıyla; "uzatıldı" kaydı bağlı müşteri teklif belgesini **eskitir** (DB tetikleyicisi) → teklif revize edilir, yeni opsiyon tarihi uzatılmış tarihi kullanır | ✅ |
| S-06 | Kapora önce: müşteri kuralında kapora varsa ve tahsil edilmemişse etkinlik öncesi / ön ödeme parçası için ödeme talebi → `warn` (vars.): 409 `DEPOSIT_FIRST_REASON_REQUIRED`, gerekçeyle talep → ödeme onay kartı "KAPORA ÖNCE İSTİSNASI", kritik, **Face ID**; istisna `meta.depositFirstException`'da (haftalık liste için). `block`: 409 `DEPOSIT_FIRST_BLOCKED`. Kural `depositFirstMode` | ✅ (haftalık istisna listesi ekranı v0.5-B) |
| S-07 | Kur politikası her teklifte zorunlu ve kayıtlı (`quotes.fx_policy`: kur kaynağı/tarihi, fiyat sabit son gün, kur payı %, piyasa kuru); boş alanlar varsayılanla dolar (kaynak/tarih = güncel kur, geçerlilik = opsiyon tarihi). Kur payı yalnız teklif para birimi ≠ ana para birimi iken; müşteri kuru = piyasa × (1+pay); iç P&L'de ayrı satır ("Kur payı — müşteriye gizli"), müşteri PDF'inde kur yazılmaz (`showFxBufferToCustomer` vars. kapalı); istenirse kur maddesi (`showFxClauseOnQuote`, `quoteFxClauseText`). **[Ürün kararı]** varsayılan kur payı `quoteFxBufferDefault` = **0** (müşteri fiyatı sorulmadan değişmesin; acenta kuraldan % verir, teklifte kişi değiştirir), üst sınır `quoteFxBufferMax` %15 | ✅ |
| D-1 | 409 `QUOTE_ACCEPTED` kaldırıldı: kabul edilmiş teklif revize edilir (Rev.N, `revisesAcceptedQuoteId`), onay kapıları yeniden işler, yeni linkle müşteri yeniden onaylar; o ana kadar kabul edilen sürüm geçerli kalır, revizyon kabul edilince eskisi `superseded`; imzalı sözleşme varsa her sözleşme için "ek protokol hazırlayın" görevi (`contract_amendment`, mevcut `amend` akışı). Belgeler her zamanki gibi eskir | ✅ |
