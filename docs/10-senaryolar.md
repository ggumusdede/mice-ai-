# 10 — İş senaryoları kataloğu (PRD v0.4)

Bu doküman PRD'nin iş kurallarını **API düzeyinde uçtan uca** sınayan senaryoların yaşayan kataloğudur. Her yeni PRD sürümünde
(v0.5, v0.6 …) değişen / eklenen kural için buraya satır ve `apps/api/test/scenarios/` altına test eklenir.

## Nasıl çalışır

- Testler: `apps/api/test/scenarios/*.test.ts` (vitest + `app.inject`, gerçek PostgreSQL `mice_test`, mock AI, test saati / rng).
  Çalıştırma: `cd apps/api && npx vitest run test/scenarios` (tümü: `npx vitest run`). Başka bir veritabanında koşmak için
  `TEST_DATABASE_URL` / `TEST_MIGRATION_DATABASE_URL` (ör. `mice_test_scn`) — aynı anda iki koşu aynı şemayı sıfırlamasın.
- Ortak kurgu: `apps/api/test/scenarios/_scenario.ts`
  - `scenarioSuite()` — dosya başına bir uygulama; her testten önce saat 20.11.2026 Cuma 10:00 (İstanbul), `rng = 0.99`.
  - `makeWorld(S, etiket)` — yeni acenta (kiracı): 5 rol için oturum, tohum tedarikçiler (`moda`, `kalamis`, `galata` [aday] …),
    müşteriler (`new` = varsayılan kurallar, `trusted` = online onay / kaporasız / özel madde, `deposit` = %30 kapora, TRY).
  - `w.flow()` — tek proje üzerinde akıcı, `await` edilebilir adım zinciri; her adım HTTP API'den geçer, hata durum kodu ile atılır:
    `intake → assign → rfqs → approveRfqs → portalOffer / offer / offers → select → quote → approveQuote → send → accept →
    contract → approveContract → sign → amend`, ayrıca `as(rol)`, `at(saat)`, `patch`, `addItem`, `lost`, `step(...)` ve kısayol
    `signed()` (imzalı sözleşmeye kadar). Sonuç `P` (proje durumu: `id`, `code`, `items`, `offers`, `rfqTokens`, `quote`, `contracts` …),
    `p.flow()` ile devam edilir. Uç durumlar `p.id` / `p.item('hall')` ile API'yi doğrudan çağırır.
  - Yardımcılar: `w.cards / card / decide` (karar kutusu, biyometri gerekirse dev step-up), `w.worker(saat)`, `w.rules(patch)`,
    `w.inboundEmail(...)` (imzalı webhook), `w.whatsapp(...)`, `upload(...)` (multipart), `ownerSql` (yalnız düzenleme / gözlem).
- Yeni senaryo ekleme: kimlik (`S<adım>-nn`, `G-nn`, `MT-nn`, `R-nn`, `C-nn`) + PRD § test adında; açık ürün sorusu varsa test adında
  `[Ürün sorusu]` ve aşağıdaki "Açık sorular" listesine satır.

## Katalog

| ID | PRD § | Senaryo | Test dosyası |
|---|---|---|---|
| S0-01 | §7.0 | e-posta talebi: proje kodu PRJ-####-MÜŞTERİ-TARİH-KİŞİ-TESİS, kalemler, ön eşleştirme (semt önce), atama kartı yalnız yöneticide | `step0-intake.test.ts` |
| S0-02 | §7.0 | mükerrer: aynı müşteri + çakışan tarih uyarı; çakışmayan tarih / başka müşteri / kaybedilmiş proje uyarı vermez | `step0-intake.test.ts` |
| S0-03 | §7.0 | eksik bilgi: soru taslağı fiyat içermez, yönetici onayı gerekmez; ekip kendi adresinden gönderir | `step0-intake.test.ts` |
| S0-04 | §7.0 | bütçe yok → eksik listesinde; ekip segment seçer ve akış durmaz (RFQ açılır) | `step0-intake.test.ts` |
| S0-05 | §15 | dil: İngilizce talep ayıklanır, soru taslağı İngilizce | `step0-intake.test.ts` |
| S0-06 | §15 | dil: Rusça talep ayıklanır, soru taslağı Rusça | `step0-intake.test.ts` |
| S0-07 | §15 | sesli komut: "… proje aç" → talep kartı (kanal ses); soru → cevap | `step0-intake.test.ts` |
| S0-08 | §7.0 | kaybedilen talep de kod alır ve ölçülür (haftalık rapor kayıp nedeni); kayıp nedeni zorunlu | `step0-intake.test.ts` |
| S0-09 | §17.10 | mesai sayacı: kayıt zamanından itibaren yalnız mesai saatleri (hafta sonu sayılmaz) | `step0-intake.test.ts` |
| S0-10 | §8 | müşteri kartı eşleşmesi: bilinen müşteri adı → kart + kısa kod; bilinmeyen → isimden kod | `step0-intake.test.ts` |
| S1-01 | §17.6 | 3 tedarikçiden az: gerekçesiz reddedilir; gerekçe kayda geçer, kart kritik rozetli ve haftalık raporda görünür | `step1-rfq.test.ts` |
| S1-02 | §17.6 | 5 tedarikçiden fazla gerekçesiz reddedilir, gerekçeyle kabul; tek tedarikçili talep gerekçeyle 1 RFQ | `step1-rfq.test.ts` |
| S1-03 | §7.1 | aday tedarikçi fiyat verebilir ama müşteriye sunulamaz / konfirme edilemez; yönetici akredite edince sunulabilir | `step1-rfq.test.ts` |
| S1-04 | §7.1 | ekibin eklediği tedarikçi her zaman "aday" açılır | `step1-rfq.test.ts` |
| S1-05 | §7.1 | takip: 24 saatte yanıt vermeyenlere otomatik hatırlatma (yanıt verene değil), 48 saatte "telefonla ara" görevi | `step1-rfq.test.ts` |
| S1-06 | §17.6 | acil talep: gerekçeyle 24 saat yanıt süresi → 12 sa hatırlatma, 24 sa telefon görevi | `step1-rfq.test.ts` |
| S1-07 | §17.5 | tedarikçi son tarihe kadar revize eder → yeni sürüm (eskisi silinmez, seçim yeni sürüme kayar); sonra salt okunur; opsiyon bitince link kapanır | `step1-rfq.test.ts` |
| S1-08 | §17.5 | proje kaybedilince linkler kapanır, hatırlatma gitmez; ekip iptali gerekçe ister | `step1-rfq.test.ts` |
| S1-09 | §7.1 | pasif tedarikçi, yanlış hizmet türü ve aynı tedarikçiye ikinci açık RFQ reddedilir | `step1-rfq.test.ts` |
| S1-10 | §7.1 | G-15 RFQ sorumlunun adresinden gider; tedarikçi müşteri adını görmez (güvenli referans) | `step1-rfq.test.ts` |
| S1-11 | §6 | RFQ kartı reddedilirse RFQ iptal, tek e-posta gitmez | `step1-rfq.test.ts` |
| S1-12 | §7.1 | tedarikçi yanıtı fiyat geçmişine kalem kalem yazılır; yanıt süresi tedarikçi kaydına işlenir | `step1-rfq.test.ts` |
| S2-01 | §7.2 | KDV dahil / hariç teklifler KDV hariç tek tabana çevrilir | `step2-compare.test.ts` |
| S2-02 | §7.2 | konaklama vergisi ayrı: vergi dahil fiyat %2 + KDV ayrıştırılır | `step2-compare.test.ts` |
| S2-03 | §7.2 | çok para birimi: TRY teklif EUR'ya kayıtlı kurla çevrilir; TRY müşteri teklifinde kur kaynağı ve tarihi kayıtlı | `step2-compare.test.ts` |
| S2-04 | §9 | kanal fiyatıyla avantaj % → markup kademesi; markup ve marj ayrı | `step2-compare.test.ts` |
| S2-05 | §9 | iadesiz kanal fiyatı esnek grup fiyatıyla kıyaslanmaz → "bilmiyorum", en düşük kademe | `step2-compare.test.ts` |
| S2-06 | §3.7 | geçmiş veri yoksa "bilmiyorum" (etkinlik kalemi); geçmiş medyan varsa salon değerlendirilir | `step2-compare.test.ts` |
| S2-07 | §7.2 | gizli maliyetler ayrıca işaretlenir (garanti > kişi, %50 ön ödeme, iadesiz iptal) | `step2-compare.test.ts` |
| S2-08 | §7.2 | pazarlık: yalnız izinli argümanlar; 3 tur onaylı taslak, 4. tur reddedilir → telefon görevi | `step2-compare.test.ts` |
| S2-09 | §7.2 | rakip fiyatı argüman olamaz: yönetici "Düzelt" ile rakip adı / fiyatı eklerse mesaj gönderilmez | `step2-compare.test.ts` |
| S3-01 | §7.3 | müşteri opsiyonu tedarikçi opsiyonundan uzun olamaz → bloklanır; eşit tarih kabul | `step3-quote.test.ts` |
| S3-02 | §7.3 | hedef marj altı bloklanır; yalnız yönetici gerekçe + Face ID ile açar; gerekçe teklifte kayıtlı | `step3-quote.test.ts` |
| S3-03 | §7.3 | marj sınırı: %8,1 marj geçer (hedef %8); yönetici teklifte gerekçe yazarsa hemen açılır, clerk yazarsa açılmaz | `step3-quote.test.ts` |
| S3-04 | §4 | kapsamlı yetki: clerk tanımlı müşteride serbest, diğerinde onaya; etkinlik tipi kapsamı da serbest bırakır | `step3-quote.test.ts` |
| S3-05 | §4 | yetki seviyeleri: "her teklif onaya" clerk ve satış dışı rol her zaman onaya; "tam yetki" serbest | `step3-quote.test.ts` |
| S3-06 | §7.3 | müşteriye özel kurallar otomatik uygulanır ve listelenir (ödeme/iptal maddesi yok, özel madde) | `step3-quote.test.ts` |
| S3-07 | §7.3 | seçenek sayısı 2–3: 1 ve 4 seçenek bloklanır, 3 kabul | `step3-quote.test.ts` |
| S3-08 | §17.4 | katma değer kalemi (alış 0, satışı acenta belirler): bloklamaz, RFQ açılmaz, kâr-zararda "katma değer" | `step3-quote.test.ts` |
| S3-09 | §3.5 | veri değişince belge eski: eski teklif gönderilemez; yeni sürüm üretilir, eski sürüm ve kartı kapanır | `step3-quote.test.ts` |
| S3-10 | §7.3 | aday tedarikçi yalnız B seçeneğinde olsa bile teklif bloklanır | `step3-quote.test.ts` |
| S3-11 | §15 | onay kartında "Düzelt" teklifi ekibe geri gönderir, "Reddet" reddeder; karar kapanır | `step3-quote.test.ts` |
| S3-12 | §7.3 | konaklama ve hizmet KDV oranları ayrı, konaklama vergisi ayrı satır; PDF üretilir | `step3-quote.test.ts` |
| S3-13 | §7.4 | kaybedilen projeye teklif hazırlanamaz | `step3-quote.test.ts` |
| S4-01 | §7.4 | online onay yeterli müşteri: açılma zamanı görünür, seçenek seçip onaylar → kazanıldı; ikinci onay reddedilir | `step4-approval.test.ts` |
| S4-02 | §17.2 | yeni müşteri varsayılanı: PO / imzalı form şart; online seçim kesin onay değildir | `step4-approval.test.ts` |
| S4-03 | §7.4 | revizyon: kişi/tarih değişti → Adım 1; yalnız fiyat → Adım 2; fark listesi ve görev | `step4-approval.test.ts` |
| S4-04 | §7.3 | opsiyon süresi dolan teklif online onaylanamaz | `step4-approval.test.ts` |
| S4-05 | §7.4 | takip: yanıt yoksa 2 iş günü sonra hatırlatma taslağı (onaylı gönderim); opsiyondan 2 gün önce ikinci (acil) taslak | `step4-approval.test.ts` |
| S4-06 | §7.4 | tedarikçi opsiyon alarmı: seçili teklifin opsiyonu dolmak üzere → görev + uzatma talebi taslağı (onaya, güvenli referans) | `step4-approval.test.ts` |
| S4-07 | §7.4 | kayıp nedeni zorunlu; açık (kararsız) proje kapatılamaz; kayıp + neden → kapanır | `step4-approval.test.ts` |
| S4-08 | §7.4 | kaybedilen projede gönderilmiş teklif için takip taslağı üretilmez | `step4-approval.test.ts` |
| S5-01 | §7.5 | karşılıklı koşul riski: tedarikçi %30 ön ödeme, müşteriden kapora yok → risk tutarıyla yöneticiye | `step5-contract.test.ts` |
| S5-02 | §17.2 | kaporalı müşteri (%30) → risk karşılanır; taahhüt kaydı kapora + bakiye alacak, ön ödeme + bakiye borç | `step5-contract.test.ts` |
| S5-03 | §7.5 | tedarikçi sözleşmesi alan alan karşılaştırılır (tarih, kişi, birim fiyat, ödeme) → fark kartı + revizyon taslağı; temiz olana kadar imza yok | `step5-contract.test.ts` |
| S5-04 | §7.5 | boş müşteri / fatura alanı hata sayılır; fatura bilgisi projeye girilince yeniden karşılaştırma temiz | `step5-contract.test.ts` |
| S5-05 | §17.4 | katma değer kalemi sözleşme kontrolünde hata sayılmaz, "katma değer" olarak işaretlenir | `step5-contract.test.ts` |
| S5-06 | §7.5 | akreditasyon kilidi: aday tedarikçiyle sözleşme açılmaz; onaydan sonra pasife alınan tedarikçi imzalanamaz | `step5-contract.test.ts` |
| S5-07 | §17.8 | imza yetkisi: yalnız kurucu / yetkilendirilmiş kişi, yönetici onayından sonra; clerk imza kaydedemez | `step5-contract.test.ts` |
| S5-08 | §7.5 | imzalı sürüm kilitli → ek protokol; maliyet artışı marjı hedefin altına düşürürse yönetici kararı | `step5-contract.test.ts` |
| S5-09 | §6 | tedarikçi konfirmasyonu yalnız taslak: yetkisiz gönderemez, yönetici gönderince rezervasyon konfirme | `step5-contract.test.ts` |
| S5-10 | §14 | düşük güvenli sözleşme okuması fark olmasa da imzaya geçmez (insan kontrolü) | `step5-contract.test.ts` |
| S6-01 | §7.6 | sözleşme tarihlerinden takvim: kalem türüne göre görevler, sorumlu role atanır (transfer yoksa transfer listesi yok) | `step6-ops.test.ts` |
| S6-02 | §17.9 | rooming listesi: rıza verenin verisi saklanır, vermeyenin süre sonunda anonimleşir; ekip rızayı geri çekebilir | `step6-ops.test.ts` |
| S6-03 | §17.1 | saha ekstra limitleri dahil: kalem 5.000 TL / proje 15.000 TL saha kararı; 5.000,01 ve 15.000 üstü yönetici; reddedilen toplamı düşürür | `step6-ops.test.ts` |
| S6-04 | §17.7 | müşteri onay linki: kişi/zaman/tutar kaydı; 30 gün sonra link geçersiz; çevrimdışı tekrar gönderim idempotent | `step6-ops.test.ts` |
| S6-05 | §7.6 | yansıtma kararı: yansıtılmazsa gerekçe zorunlu; yansıtılmayan toplamlar proje / müşteri bazında ve haftalık raporda | `step6-ops.test.ts` |
| S6-06 | §7.6 | günlük 3 satırlık özet; etkinlik günü 18:00 sonrası müşteri taslağı (insan gönderir) + yönetici bildirimi | `step6-ops.test.ts` |
| S6-07 | §7.6 | değişiklik akışı: sözleşmeli kalem değişince tedarikçi bildirimi taslağı (onaylı) + marj eşik altına düşerse yönetici kartı | `step6-ops.test.ts` |
| S7-01 | §7.7 | tedarikçi faturası sözleşmeye bağlanır; tolerans (%0,5) içi alarm yok, üstü alarm + görev + yönetici bildirimi; mükerrer fatura reddedilir | `step7-finance.test.ts` |
| S7-02 | §7.7 | farklı para birimi: TRY fatura EUR'ya çevrilir, sözleşme EUR olduğundan para birimi alarmı | `step7-finance.test.ts` |
| S7-03 | §7.7 / §17.1 | ödeme: finans talep eder (onaylayamaz) → yönetici Face ID ile tek tek onaylar → "ödendi"yi insan işaretler; clerk talep açamaz | `step7-finance.test.ts` |
| S7-04 | §17.1 | vekil (finans) kendi açtığı ödeme talebini onaylayamaz; yönetici onaylayabilir | `step7-finance.test.ts` |
| S7-05 | §7.7 | banka ekstresi (TR biçimi: ; ayraç, 1.234,56, GG.AA.YYYY): otomatik eşleşme / öneri / eşleşmeyen; tekrar yükleme idempotent | `step7-finance.test.ts` |
| S7-06 | §7.7 | fatura edilmemiş ödeme: ödeyene her gün hatırlatma, 7. günde yöneticiye eskalasyon (6. gün değil); eşleştirince kapanır | `step7-finance.test.ts` |
| S7-07 | §7.7 | komisyon mutabakatı (ayrı faturalanan %10, KDV ayrı notu) + Mikro Excel aktarımı (tarih filtresi, cari kodlar) | `step7-finance.test.ts` |
| S7-08 | §10 | e-Fatura UBL-TR: VKN ile tedarikçi bulunur, AI'sız (güven 1.0) okunur, sözleşmeyle tutar uyumlu; aynı ETTN ikinci kez reddedilir | `step7-finance.test.ts` |
| S7-09 | §7.7 | müşteri faturası taslağı: sözleşme + müşteri onaylı VE yansıtılan ekstralar (yansıtılmayan / onaysız değil) | `step7-finance.test.ts` |
| S8-01 | §7.8 | kapanış tüm koşullar sağlanana kadar bloklu (fatura, müşteri faturası, tahsilat, komisyon); clerk kapatamaz | `step8-closing.test.ts` |
| S8-02 | §7.8 | fatura edilmemiş ödeme kapanışı bloklar (ödenmiş borç, fatura yok) | `step8-closing.test.ts` |
| S8-03 | §7.8 | kapanış yan etkileri: gerçekleşen fiyat → fiyat geçmişi, tedarikçi skoru (düşük → yönetici kararı), anket, "neyi geç öğrendik" → kontrol listesi önerisi → sonraki talepte soru | `step8-closing.test.ts` |
| S8-04 | §7.8 / §17.10 | kapanış süresi: etkinlik bitişi + 30 gün içinde uyarı yok, aşılınca yöneticiye uyarı (bir kez) | `step8-closing.test.ts` |
| S8-05 | §4 | ekip kaydı: kişi bazlı yetki verisi (teklif sayısı, düzeltilen, kazanma oranı) yöneticiye görünür | `step8-closing.test.ts` |
| G-01 | §17.1 | vekâlet penceresi: başlamadan önce ve bittikten sonra vekil karar veremez; süre içinde verir ve "vekil" işaretlenir | `governance.test.ts` |
| G-02 | §17.1 | vekil akreditasyon, kural / eşik / yetki değişikliği, otomasyon terfisi ve kontrol listesi kararı veremez; düşük skor (akreditasyon kararı) da yöneticide | `governance.test.ts` |
| G-03 | [Ürün sorusu] §7.3 §17.1 | hedef marj altı teklifi vekil gerekçeyle açabiliyor (PRD: "yalnızca yönetici") — mevcut davranış | `governance.test.ts` |
| G-04 | §16 | otomasyon terfisi: 20 düzeltmesiz onaydan sonra "otomatik yapayım mı?"; düzeltme sayacı sıfırlar; terfi → otomatik + ~1/20 örneklem; hatalı örneklem → otomatik geri dönüş | `governance.test.ts` |
| G-05 | [Ürün kararı] | neverAutomateKinds: müşteri teklifi onayı 20+ temiz onayda bile terfi önerilmez ve terfi edilemez | `governance.test.ts` |
| G-06 | §6 | yasak işlemler veritabanında da engelli: AI aktörü akredite edemez, imza kaydedemez, ödeme onaylayamaz, kural yazamaz | `governance.test.ts` |
| G-07 | §16.5 | kural önerisi (tedarikçi × sezon) kanıtla gelir, yalnız yönetici uygular, sonraki değerlendirmede kullanılır | `governance.test.ts` |
| G-08 | §16.6 / §17.10 | haftalık rapor: teklif süresi mesai saatiyle (hafta sonu + tatil hariç), müşteri bekleme ayrı, hedef oranı | `governance.test.ts` |
| MT-01 | §3.8 | iki acenta aynı senaryoyu paralel koşar: kodlar kendi sırasında, listeler / kararlar / id ile erişim ayrık | `tenants-roles.test.ts` |
| MT-02 | §3.8 | public linkler ve webhook'lar kiracıya bağlı: A'nın linki yalnız A verisini açar; B'nin imzası A anahtarında geçmez | `tenants-roles.test.ts` |
| MT-03 | §3.8 | worker tüm kiracıları ayrı işler: hatırlatmalar her acentanın kendi kullanıcısından ve kendi tedarikçisine | `tenants-roles.test.ts` |
| R-01 | [Ürün kararı] | fieldRoleCanSeeFinancials: kapalıyken saha kâr / teklif / finans göremez; açılınca görür | `tenants-roles.test.ts` |
| R-02 | §17.1 | clerk onay kartlarını göremez / veremez; finans ödeme onaylayamaz; ops teklif gönderemez | `tenants-roles.test.ts` |
| R-03 | §4 G-17 | rol veya yetki değişikliği eski oturumları sonlandırır; yönetici kendini düşüremez | `tenants-roles.test.ts` |
| R-04 | §3.3 | taslağı yalnız sahibi veya yönetici gönderir; saha başkasının taslağını göremez | `tenants-roles.test.ts` |
| C-01 | §7.0 | bilinmeyen göndericiden e-posta → talep (proje kodu, insan oluşturmadı); aynı Message-ID tekrar işlenmez | `channels.test.ts` |
| C-02 | §7.1 | tedarikçi RFQ e-postasına yanıt verir → mevcut teklif okuma (yeni sürüm), RFQ "yanıtlandı" | `channels.test.ts` |
| C-03 | §6 | müşteri e-postayla "onaylıyoruz" der → otomatik kabul YOK, sorumluya görev + kritik bildirim | `channels.test.ts` |
| C-04 | §10 | WhatsApp Business: bilinmeyen numaradan mesaj → talep; imzasız istek reddedilir | `channels.test.ts` |

Toplam **102 senaryo**: Adım 0: 10 · Adım 1: 12 · Adım 2: 9 · Adım 3: 13 · Adım 4: 8 · Adım 5: 10 · Adım 6: 7 · Adım 7: 9 · Adım 8: 5 ·
yönetişim: 8 · çok kiracılı: 3 · roller: 4 · gelen kanallar: 4.

## Senaryolarla bulunan ve düzeltilen hatalar

| Senaryo | Hata | Düzeltme |
|---|---|---|
| S2-09 | Pazarlık kartında "Düzelt" ile rakip tedarikçi adı / fiyatı eklenince mesaj kontrolsüz gidiyordu (kontrol yalnız AI taslağında) — §7 Adım 2 | `apps/api/src/services/registry.ts` `assertNoCompetitorArgument` → 400 `NEGOTIATION_RULE_VIOLATION` |
| S4-08 | Kaybedilen projede gönderilmiş teklif için worker müşteri takip taslakları üretmeye devam ediyordu — §7 Adım 4 | `apps/api/src/worker.ts` `buildState`: yalnız `outcome = 'open'` projelerin teklifleri |
| S5-08 | Ek protokol marj etkisi KDV + konaklama vergisi dahil alacakla (brüt) hesaplanıyordu → marj şişiyor, hedef altı düşüş kaçıyordu — §7 Adım 5/6 | `apps/api/src/services/contracts.ts` `amendContract`: satış = kabul edilen seçeneğin net satırları |
| G-02 | Düşük tedarikçi skoru kartı (Düzelt = pasife alma, akreditasyon kararı) vekile açıktı — §7 Adım 8, §17.1 | `packages/domain/src/authority.ts` `ADMIN_ONLY_DECISIONS` + `low_supplier_score` |

## Ürün sahibi kararları (22.11.2026)

| # | Soru | Karar | Uygulama | Test |
|---|---|---|---|---|
| Q1 | Vekil hedef marj altı teklifi açabilir mi? | Vekil teklifi hazırlayıp açabilir; açma kararı acenta yöneticisinin (admin) onayına sunulur | `margin_override` → `ADMIN_ONLY_DECISIONS` (`packages/domain/src/authority.ts`) | G-03 |
| Q2 | Kaybedilen projede müşteri linki | Proje "lost" olarak listelenir, kayıp nedeni bildirilir; müşteri linki artık kabul/revizyon almaz (409 `QUOTE_NO_LONGER_VALID`) | `assertProjectOpenForCustomer` (`apps/api/src/services/quotes.ts`) | S4-09 |
| Q3 | Mikro aktarımında sıralama/tarih | Yeniden eskiye; tarih filtresi fatura tarihi (yoksa kayıt tarihi) | `mikroExport` ORDER BY … DESC (`services/finance.ts`) | S7-07 |
| Q4 | Kim talep tanımlayabilir? | Müşteriden gelen her talebi tüm kullanıcılar sisteme tanımlayabilir | `/api/intake` zaten tüm rollere açık (değişiklik gerekmedi) | S0-* |
| Q6 | Aday tedarikçi teklifi bloklarsa? | Satış / operasyon teklif oluşturucudan "Akreditasyon iste" der; yöneticiye `supplier_accreditation` kartı açılır (açık kart varsa yeniden kullanılır). Karar yalnız yöneticide kalır (ana çatı 5) | `POST /api/suppliers/:id/request-accreditation` (`requestAccreditation`, `services/suppliers.ts`; kart proje-bağımsız); web `RequestAccreditationButton` (`QuoteTab.tsx`) | Q6-01, e2e 04 |
| Q7 | Kaybedilen projenin açık kararları + satışçı performansı | Proje kaybedilince açık kararları `expired` olur, `reason = "proje kaybedildi: <neden>"`; silinmez, denetim izinde ve `?status=expired` geçmişinde görünür. Yönetici "Ekip performansı" raporu (varsayılan son 12 ay): talep, gönderilen teklif, kazanılan/kaybedilen, kazanma oranı, kayıp projeler + nedenler, ort. teklif süresi (iş saati) / hedef, kazanılanlarda planlı marj ve markup (ayrı), gerçekleşen kâr EUR (+ kur kanıtı varsa TL), düzeltme oranı, onaylı / serbest teklif. Proje metrikleri proje sahibine, teklif kalitesi teklifi hazırlayana yazılır; sahibi bilinen geçmiş projeler sayılır | `setOutcome` (`services/projects.ts`); `teamPerformance` (`services/reports.ts`), `GET /api/reports/team-performance?from=&to=` (admin); web `/yonetim/ekip-performansi` (390 px kart, masaüstü tablo) | Q7-01, Q7-02, e2e 18 |
| Q8 | PO numarası = proje kodu mu? | Hayır: PO müşterinin kendi satın alma numarasıdır, proje kodumuz ayrı kalır. Teklif yanıtında `poNumber`, `acceptedByName`, `firmApprovedAt`, `awaitingSignedForm` (eklemeli); başlıkta ve teklif sekmesinde proje kodunun yanında; projeler PO ile aranır; müşteri teklif PDF'inde "Referans" = proje kodu (müşteri PO'sunda belirtir) | `mapQuoteBase` (`lib/mappers.ts`), `listProjects` q (`services/projects.ts`), quote PDF meta (`services/quotes.ts`) | Q8-01, e2e 18 |
| Q9 | Hızlı revizyon | Teklif sekmesinde "Revize et": mevcut revizyon aynı editörde dolu açılır, yalnız değişen düzeltilir → aynı teklif dosyasının sonraki revizyonu (Rev.N, aynı proje kodu), belgeler otomatik üretilir. Gönderilmiş revizyonlar salt okunur ve görünür kalır (ana çatı 3). Fiyatı etkileyen değişiklikte "Yeniden üret" hata yerine "Revize et" sunar. Doğrulama + onay kapıları yeni revizyonda yeniden işler. Yalnız en son revizyon revize edilir (409 `QUOTE_NOT_LATEST`); kabul edilmiş teklif buradan revize edilmez (409 `QUOTE_ACCEPTED`, temkinli varsayılan — [Ürün kararı]) | `POST /api/quotes/:id/revise` (`reviseQuote`, `services/quotes.ts`; `QUOTE_REBUILD_REQUIRED` detayında `quoteId`); web `lib/quoteRevision.ts`, `QuoteTab.tsx`, `SidePanel.tsx` | Q9-01, Q6-01, web `quoteRevision.test.ts`, e2e 05 |

## Açık sorular (ürün sahibi)

1. **[Ürün sorusu] G-03** — §7.3 "hedef marj altı yalnızca yönetici gerekçe yazarak açar" ile §17.1 vekâlet (vekilin yasakları yalnız
   akreditasyon + kural/eşik/yetki) çelişiyor: bugün aktif vekil `margin_override` kartını gerekçeyle açabiliyor (`viaDelegation` işaretli).
   Vekile kapatılsın mı?
2. **Kaybedilen projede müşteri teklif linki** — §17.5 kayıpta tedarikçi linklerini kapatır; müşteri `/q/<token>` linki açık kalıyor ve
   kabul edilirse proje `won` olur (kapanmış kayıp projede bile). Kayıpta teklif linki de kapansın mı, yoksa "müşteri geri döndü" senaryosu
   için açık mı kalsın?
3. **Komisyon satırının Mikro aktarım tarihi** — komisyon kaydında fatura tarihi yok; Mikro aktarımı kayıt tarihine göre süzüyor (S7-07).
   Mutabakat tarihi mi, tedarikçi fatura tarihi mi esas alınsın? [Doğrulanmalı — muhasebe]
4. **RFQ oluşturma rolü** — kod RFQ açmayı rol kısıtlamadan yapıyor (onay kartı satış rolünde). PRD Adım 1'i "ekip" diye tanımlıyor; saha /
   finans rollerinin RFQ açması engellensin mi?
5. **Günlük özet "günde bir kez" kontrolü** DB `now()` ile yazılan `created_at`'e bakıyor (S6-06 notu); üretimde doğru, test saatiyle
   doğrulanamıyor — `ctx.now()` ile yazılması önerilir (davranış değişmez).


## Tarayıcı senaryoları

Yukarıdaki API senaryolarının arayüz tarafı: Playwright (headless Chromium) ile **çalışan** sunuculara karşı (`AI_PROVIDER=mock` API :3001 +
web :5173). Hepsi birden `node e2e/run-all.mjs` — betik / sonuç (PASS · FAIL · SKIP) / süre tablosu, herhangi biri başarısızsa çıkış 1;
ortam değişkenleri ve kurulum: [README — Tüm tarayıcı senaryoları](../README.md#tüm-tarayıcı-senaryoları-e2erun-allmjs). Ortak yardımcılar
`e2e/lib/harness.mjs` + `e2e/lib/setup.mjs`; ön koşullar API ile hazırlanır, test edilen kısım arayüzden sürülür; her koşu yeni proje açar.
Aynı tablo `e2e/SCENARIOS.md`'de de durur.

| # | Betik | PRD | Doğrulanan |
|---|---|---|---|
| — | `steps0-5.mjs` | §7 Adım 0–5 | intake → atama → RFQ → tedarikçi formu → karşılaştırma / pazarlık → 2 seçenekli teklif → onay → müşteri kabulü → sözleşme → imza |
| — | `steps6-8.mjs` | §7 Adım 6–8 | fatura bilgisi düzeltme → operasyon, rooming / KVKK, saha ekstrası, finans, banka, kapanış, anket, rapor, kurallar, vekâlet |
| 1 | `scenarios/01-revision-loop.mjs` | §7 Adım 4 | müşteri `/q/` üzerinden kişi sayısı revizyonu ister → proje Adım 1'e (RFQ) döner, v1 "Revizyon istendi" + görev → v2 oluşturucuda → yönetici onayı → gönderim → eski link 410, v2 kabul → "Kazanıldı" |
| 2 | `scenarios/02-lost-project.mjs` | §7 Adım 4 | "Kaybedildi" alt panelinde gerekçe zorunlu (boş / boşluk → pasif) → Açık filtresinden ve saha panelinden düşer → haftalık rapor "Kayıp nedenleri" gerekçeyi 1 sayar |
| 3 | `scenarios/03-delegation.mjs` | §17.1 | yönetici `/yonetim/vekalet`te ops'a bugün için vekâlet → ops ödeme kartını görür, "Vekil olarak onaylıyorsunuz", onaylar; akreditasyon kartını görmez → vekâlet bitince kart görünmez, API 403 |
| 4 | `scenarios/04-candidate-supplier.mjs` | §7 Adım 1, §17.1 | ops kalem kartından aday tedarikçi ekler → kısa listede "Aday" → RFQ + `/s/rfq/` teklifi → oluşturucu "Aday tedarikçi" işaretler, teklif bloklanır → bloklu teklifte "Akreditasyon iste" (Q6, idempotent) → yönetici karar kutusundan "Akredite et" → aynı teklif geçer |
| 5 | `scenarios/05-stale-documents.mjs` | §3.5 | onaylı teklifin belgesi "Güncel" → kişi sayısı değişir → "Eski" + uyarı; "Müşteriye gönder" 409; fiyat değişikliğinde "Yeniden üret" reddedilir (yeni sürüm) → v2; fiyatsız değişiklikte (başlık) yeniden üret → "Güncel" → gönderim |
| 6 | `scenarios/06-margin-override.mjs` | §7 Adım 3, §9 | %3 markup → istemci ön kontrolü kırmızı, sunucu bloklar → "Marj istisnası" kartında gerekçesiz birincil eylem ve dev yedek pasif → gerekçe + (dev) biyometrik → "Onaylandı", gerekçe kayıtlı |
| 7 | `scenarios/07-mobile-admin-day.mjs` | §15 | 390×844 karar kutusu: teklif, ödeme, akreditasyon, saha ekstra, pazarlık kartları; yatay kaydırma yok → "Düzelt" ile pazarlık taslağı düzeltilir, saklanan gövde düzeltilmiş metin → akreditasyon gerekçeyle reddedilir (gerekçesiz pasif) → teklif / ödeme / ekstra onayı → kalanlar → "Her şey yolunda" |
| 8 | `scenarios/08-field-mobile.mjs` | §17.7, §18.16 | saha kullanıcısı "Bugünkü projeler" → kontrol listesi → hızlı sorun kaydı → 400 TL "Limit içinde", 6.500 TL "Limit aşıldı" → `setOffline(true)` ekstra kuyruğa ("1 kayıt gönderilmeyi bekliyor") → çevrimiçi → tam 1 kez kaydedilir (yeniden yüklemeden sonra da) |
| 9 | `scenarios/09-supplier-portal.mjs` | §10, §17.5 | geçersiz link sayfası · teklif v1 + CSV eki (yeni sürüm) + revizyon → ekip Teklifler'de güncel sürümü ve "Önceki sürümler"de v1'i görür · son tarih geçince (psql) form salt okunur · proje kaybedilince link kapanır |
| 10 | `scenarios/10-customer-quote.mjs` | §7 Adım 4, §17.2 | ekip kartında "Açıldı" müşteri açmadan yok, açınca var · PO zorunlu müşteri PO'suz onaylayamaz · "online onay" müşterisinde PO alanı yok, adla kabul → kazanıldı |
| 11 | `scenarios/11-role-based-ui.mjs` | §4, G-16 | satış: Yönetim / Finans / Rapor menüsü yok, kurallar salt okunur + PATCH 403 · finans: Finans sayfası var, ödeme kartı yok, onay 403 · saha: finansal veri yok → yönetici Kurallar'da "Saha rolü finansal verileri görebilir"i açar → saha "Beklenen kâr" ve Finans sekmesini görür (sonra geri alınır) |
| 12 | `scenarios/12-admin-rules.mjs` | §8 Blok 5, §9 | markup kademeleri arayüzde +5 puan → karşılaştırmadaki "Önerilen markup" +5 puan; ürün kararı anahtarları görünür (geri alınır) |
| 13 | `scenarios/13-bank-statement.mjs` | §7 Adım 7 | `/finans`'ta CSV → özet (Okunan 3 = eşleşti + öneri + eşleşmedi), filtreler → fatura no'lu ödeme otomatik eşleşir, ilgisiz satır eşleşmez → referanssız tahsilat elle müşteri alacağına eşleştirilir |
| 14 | `scenarios/14-inbound-email.mjs` | §7 Adım 1 | yanlış imza 401 → doğru HMAC'li webhook (konu `[PRJ-####]`) → teklif Teklifler'de "E-posta" kaynaklı, Genel bakış "Gelen kutusu"nda "Tedarikçi yanıtı" + "Teklif vN →" |
| 15 | `scenarios/15-kvkk.mjs` | §17.9 | rooming formunda rıza varsayılan kapalı; rızalı + rızasız misafir → e-postadaki geri çekme linki (HTML form "İznimi geri al") → ops'ta "Rıza geri çekildi", satışta maskeli isimler |
| 16 | `scenarios/16-accessibility.mjs` | §15 | yalnız klavyeyle giriş → kart Tab + Enter → alt panel odak tuzağı (25× Tab, 5× Shift+Tab) → Escape kapatır, odak karta döner · 14 sayfada (390 + 1366 px) etiketsiz alan / adsız düğme-link / alt'sız görsel / `lang` / `h1` kontrolü · konsol hatası yok |
| 17 | `scenarios/17-visual.mjs` | §15 | 25 sayfa (uygulama, proje sekmeleri, yönetim, saha, herkese açık formlar) 390 px ve 1280 px'te yatay kaydırmasız; tam sayfa ekran görüntüleri |
| 18 | `scenarios/18-owner-decisions.mjs` | §4, §16.7, §7 Adım 4 (Q7, Q8) | kaybedilen projenin açık kartları `expired` geçmişinde; kazanılan projede müşteri PO no proje kodunun yanında ve teklif kartında, PO ile arama; "Ekip performansı" masaüstünde tablo, 390 px'te kart (yatay kaydırma yok), kayıp nedeni listede, dönem seçimi |

**Tarayıcı senaryolarıyla bulunan ve düzeltilen hatalar**

- Teklif oluşturucu iptal edilmiş kalemleri de satır olarak gösteriyor ve varsayılan olarak dahil ediyordu → "Teklifi doğrula" 400
  `OFFER_REQUIRED` (`apps/web/src/pages/project/QuoteTab.tsx` — iptal kalemler süzülür).
- Proje detayı tedarikçi tekliflerinin yalnız güncel sürümünü dönüyordu; Teklifler sekmesindeki "Önceki sürümler" hiç görünmüyordu
  (§17.5 "eskisi silinmez") (`apps/api/src/services/projects.ts` — eski sürümler de `offers` içinde, `supersededBy` dolu).
- Düşük güvenli okuma kartı, teklif revize edilince (eski sürüm) onaylanamıyor (409 `OFFER_SUPERSEDED`) ve karar kutusunda sonsuza dek
  kalıyordu (`apps/api/src/services/offers.ts` — sürüm eskiyince açık `low_confidence_review` kararı `expired`).
- Alt panel (BottomSheet) her ebeveyn yeniden çiziminde (ör. karar kutusunun 30 sn yoklaması) odak efektini yeniden çalıştırıp odağı ilk
  düğmeye çalıyordu (`apps/web/src/components/BottomSheet.tsx` — `onClose` ref'te, efekt yalnız `open`'a bağlı).
- Rıza geri çekilen misafir ops ekranında rızası hiç olmamış gibi "Rıza yok" görünüyordu → "Rıza geri çekildi" + tarih
  (`apps/web/src/pages/project/OperationsTab.tsx`, `i18n/tr.ts`).

**Tarayıcı senaryolarından açık sorular**

1. Satış rolünün akreditasyon talebi için tek giriş noktası `/yonetim/tedarikciler` ("yalnızca yönetici" uyarılı sayfa). Teklif oluşturucudaki
   "aday tedarikçi" blok mesajına "Akreditasyon iste" eylemi eklensin mi?
2. Kaybedilen projenin açık kararları (atama, teklif onayı) karar kutusunda kalıyor ve gönderilmiş müşteri teklif linki hâlâ kabul ediyor
   (tedarikçi linkleri §17.5 gereği kapanıyor). Kayıpta bunlar da kapansın mı?
3. Müşterinin girdiği PO numarası / onaylayan adı `quotes` tablosunda saklanıyor ama `Quote` sözleşmesinde yok — ekip arayüzde göremiyor.
   Eklemeli alan olarak gösterilsin mi?
4. Gerçekleşen kâr bloğu imzadan hemen sonra (henüz fatura yok) "-€5.300 / markup -%100" gösteriyor (alış = tedarikçi borcu, satış 0).
   Faturalandırılana kadar "—" mı gösterilmeli?
5. Fiyatı etkileyen değişiklikte (kişi sayısı) eski teklif belgesi "Yeniden üret" ile değil yalnız yeni teklif sürümüyle güncellenebiliyor
   (`QUOTE_REBUILD_REQUIRED`) — ürün kuralı olarak doğru varsayıldı; arayüzde "Yeniden üret" düğmesi bu durumda "Yeni sürüm oluştur"a dönsün mü?
