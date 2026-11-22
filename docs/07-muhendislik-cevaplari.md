# 07 — Mühendise Açık Sorulara Cevaplar (§18)

> Her cevap şu bölümlerden oluşur: **Kısa cevap**, gerekçe ve tasarım, **Öneri**.
> **[Doğrulanmalı]** işareti satıcı veya avukat teyidi gerektirir. Ürün yetenekleri ve fiyatlar değişebilir; karar anında güncel belgeye bakılmalıdır.

---

## 1. Mobil: iPhone'da PWA ile Face ID ve push yeterli mi?

**Kısa cevap:** Faz 1 için **evet, koşullu olarak.** Face ID onayı WebAuthn ile güvenilir şekilde çalışır. Push bildirimi iOS 16.4 ve sonrasında yalnızca **ana ekrana eklenmiş** web uygulamasında çalışır ve "kritik" bildirim için garanti vermez. Ayrıntılı karar ve tetikleyici kriterler: [08-mobil-karar.md](08-mobil-karar.md).

| Yetenek | PWA (iOS Safari / ana ekran) | Not |
|---|---|---|
| Face ID ile onay | ✅ WebAuthn platform doğrulayıcısı, `userVerification: 'required'` | Kimlik bilgisi passkey olarak iCloud Anahtar Zinciri'nde senkronize olabilir. Apple, passkey'ler için cihaz kimliği kanıtı (attestation) vermez; bu yüzden "hangi cihaz" bilgisi kimlik bilgisi kimliği + cihaz etiketi + user-agent ile kaydedilir |
| Push bildirimi | ✅ iOS/iPadOS 16.4+, yalnızca ana ekrana eklenmiş uygulamada; izin bir kullanıcı hareketiyle istenmeli | Sessiz (background) push yok. "Time Sensitive / Critical Alert" seviyesi yok. Teslim garantisi yok. Uygulama simgesine sayaç (Badging API) var |
| Arka plan senkronizasyonu | ❌ Background Sync / Periodic Sync yok | Uygulama açıldığında senkronize edilir |
| Çevrimdışı | ✅ Service Worker + IndexedDB | Bkz. §16 |

**Öneri:**

1. Faz 1 PWA olarak ilerlesin.
2. Kritik bildirimler (opsiyon bitimi, acil ödeme, sözleşme riski) **iki kanaldan** gitsin: Web Push, yanıt gelmezse 15 dakika sonra WhatsApp veya SMS. *(Uygulandı: kural `criticalPushFallbackMinutes`, `services/critical-fallback.ts`; yöneticinin profilindeki yedek telefonuna; canlı hesaplarla test edilmedi.)*
3. Push teslim ve açılma oranı ölçülsün.
4. Native uygulama ihtiyacı 08'deki kriterlerle değerlendirilsin. Küçük bir SwiftUI uygulamasının tahmini maliyeti: 1 iOS geliştirici × 5–8 hafta + Apple Developer Program yıllık ücreti [Doğrulanmalı] + bakım.

---

## 2. Yapay zekâ ve KVKK yurt dışı aktarım

**Kısa cevap:** Yurt dışındaki bir LLM API'sine kişisel veri göndermek **KVKK m.9 kapsamında yurt dışına aktarımdır**. Hukuki dayanak olarak en uygun yol, **Kurul'un ilan ettiği standart sözleşmenin** sağlayıcıyla imzalanması ve imzadan sonra **Kurum'a süresinde bildirilmesidir**. Takma ad (pseudonymization) **riski ve aktarılan veriyi büyük ölçüde azaltır, ama tek başına yasal dayanak yerine geçmez.** Takma adlandırılmış veri, acenta eşleştirme anahtarını elinde tuttuğu sürece kişisel veri sayılır. Tüm bu yorumlar **avukatça doğrulanmalıdır.**

### Mevzuat çerçevesi (özet) [Doğrulanmalı]

- 7499 sayılı Kanunla değişen KVKK m.9 (yürürlük: 1 Haziran 2024) ve "Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik" (Temmuz 2024).
- **Aktarım yolları:**
  1. Yeterlilik kararı.
  2. Yeterlilik kararı yoksa **uygun güvenceler**: standart sözleşme, bağlayıcı şirket kuralları, taahhütname + Kurul izni.
  3. İstisnai ve **arızi** aktarım (ör. açık rıza). Sürekli iş akışında arızi aktarıma dayanmak uygun değildir.
- Standart sözleşme Kurul'un ilan ettiği metinle, **değiştirilmeden** imzalanır ve imzadan sonra kısa süre içinde (yönetmelikte **5 iş günü**) Kurum'a bildirilir.
- **Rol dağılımı:** Acenta veri sorumlusudur. SaaS sağlayıcı (biz) veri işleyendir. LLM sağlayıcı alt veri işleyendir. Aktarım senaryosuna uygun standart sözleşme türü seçilmelidir.
- **Açık soru:** LLM sağlayıcısının Türk standart sözleşmesini imzalamayı kabul edip etmediği **satıcıyla teyit edilmelidir**. Sağlayıcının kendi veri işleme sözleşmesi (DPA) ve veri saklama/ZDR koşulları da incelenmelidir.

### Teknik tasarım: "minimum kişisel veri" mimarisi

| Veri | LLM'e gider mi? | Yöntem |
|---|---|---|
| **Misafir verisi** (rooming list) | **Hayır, hiçbir zaman** | Misafirler public rooming formundan (`/r/<token>`) veya ekip API'sinden (`POST /api/projects/:id/guests`) yapılandırılmış alanlarla gelir; `services/guests.ts` hiçbir `AiService` metodunu çağırmaz. Rooming list belgesi yalnızca sayıları tutar; Excel şablonu canlı üretilir ve yalnızca yetkili rollere şifresi çözülmüş ad gösterir. Rooming Excel **içe aktarımı** henüz yok |
| Müşteri kontak adı, e-posta, telefon (talep metninde) | Takma adla (sınırlarla, aşağıya bakın) | `@mice/ai` `Pseudonymizer` (`packages/ai/src/pii.ts`; `@mice/domain` `pseudonymize()` aynı davranışın saf karşılığıdır): regex (e-posta, TR cep/sabit + uluslararası telefon, IBAN, 11 haneli TCKN benzeri) + hitaplı ad kalıpları (`Sayın …`, `Sn. …`, `… Hanım`, `… Bey`, `Mr./Mrs./Dr. …`, `Господин …`) + çağıranın verdiği bilinen adlar → `[PERSON_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[IBAN_1]`, `[NATID_1]`. Eşleşme tablosu yalnızca istek boyunca bellekte tutulur; model çıktısı `restoreDeep()` ile geri çevrilir. Taslak ve `ask` çağrılarında alıcı/gönderen ve olgulardaki kişi alanları (`collectNamesFromFacts`) bilinen ad olarak eklenir |
| Şirket adı, otel adı, fiyat, tarih | Evet | Tüzel kişi verisi kişisel veri değildir; şirket adları **bilinçli olarak maskelenmez** (talep ayıklamada bilinen müşteri adları modele açıkça verilir). **İstisna:** şahıs şirketleri; müşteri kartında "şahıs" bayrağıyla takma ad uygulanması önerilir, **henüz uygulanmadı** [Ürün kararı] |
| Tedarikçi PDF/görsel teklifleri, sözleşme ve fatura PDF'leri | Evet, **maskelenmeden** (içerikte kontak kişi adı, imza, IBAN olabilir) | PDF ve görseller süreç içinde maskelenemez; `document` / `image` bloğu olarak olduğu gibi gönderilir. `AI_ALLOW_BINARY_DOCS=false` ile PDF/görsel gönderimi tamamen kapatılır (çağrı `pii_unmaskable` hatası verir; ekip metni yapıştırır veya elle girer). Metin, CSV (Excel'den çevrilen) ve e-posta dosyaları maskelenir. PDF'den sunucuda metin çıkarıp maskeleyerek gönderme **henüz yok**. Bu belgeler standart sözleşme kapsamındaki aktarıma dayanır |
| Sesli komut ses dosyası | STT servisine gider | STT sağlayıcısı da aktarım kapsamındadır. Alternatif: Türkiye'de barındırılan açık kaynak STT (bkz. §8) |

**Ek önlemler:**

- Sağlayıcının API verisini model eğitiminde kullanmadığı ve saklama süresi sözleşmesel olarak teyit edilmeli [Doğrulanmalı].
- Anthropic API'de çıkarımın hangi coğrafyada çalışacağı `inference_geo` parametresiyle seçilebiliyor. Hangi bölgelerin sunulduğu ve bunun KVKK açısından etkisi **doğrulanmalı**. Hangi bölge seçilirse seçilsin Türkiye dışıdır.
- `ai_actions` tablosunda modele giden içeriğin kendisi değil, girdi özeti (`input_summary`) ve yapılandırılmış çıktı saklanır.
- Aydınlatma metinlerine (müşteri, tedarikçi, misafir) yurt dışına aktarım ve alıcı grupları yazılır.

### Uygulamanın bilinen sınırları (kod durumu)

Bu sınırlar avukat değerlendirmesine ve aydınlatma metinlerine girdi olmalıdır [Doğrulanmalı]:

1. **PDF ve görseller maskelenmez.** Tedarikçi teklifi, sözleşme ve fatura PDF'leri ile görseller modele olduğu gibi gider (`packages/ai/src/claude.ts` `fileBlocks`). İçlerindeki kişi adı, telefon, e-posta, IBAN ve imza modele ulaşır. Kapatmak için `AI_ALLOW_BINARY_DOCS=false` (varsayılan: açık); bu durumda yalnızca metin girdisi kabul edilir.
2. **Hitapsız imza adı talep ayıklamada maskelenmez.** `extractRequest` çağrısında bilinen kişi listesi verilmez; yalnızca regex ve hitap kalıpları çalışır. "Saygılarımla, Ayşe Yılmaz" gibi hitapsız bir imza adı modele açık gider. (Taslak ve `ask` çağrılarında olgulardaki kişi alanları bilinen ad olarak eklendiği için bu sınır daha dardır.) Müşteri kartındaki kontak adlarının bilinen ad olarak eklenmesi önerilir.
3. **Şirket adları bilinçli olarak maskelenmez** (tüzel kişi verisi; eşleştirme için gerekli). Şahıs şirketi istisnası henüz uygulanmadı.
4. **Misafir / rooming list verisi modele hiçbir zaman gönderilmez.** Misafir PII'si pgcrypto ile şifreli saklanır (`GUEST_DATA_KEY`), audit kaydına kopyalanmaz ve yalnızca `view_guest_pii` rollerine çözülür.
5. Regex tabanlı maskeleme yanlış negatif verebilir (alışılmadık telefon biçimi, ad içinde rakam vb.); `packages/ai/test/pii.test.ts` kapsadığı kalıpları belgeler.
6. Model istemi ve yanıtı kalıcı saklanmaz; `ai_actions` yalnızca girdi özeti (`input_summary`) ve yapılandırılmış çıktıyı (`output`, maske geri çevrilmiş hâliyle) tutar. Okunan teklif metni `supplier_offers.raw_text`, sözleşme metni `contracts.source_text` olarak acentanın kendi veritabanında kalır (audit'e kopyalanmaz).

**Öneri:** (1) Misafir verisi LLM'e hiç gitmesin. (2) Diğer kişisel veri takma adla gitsin. (3) Hukuki dayanak standart sözleşme + Kurum bildirimi olsun. (4) Avukat görüşü Faz 1'in **ilk 4 haftasında** alınsın. Sağlayıcı standart sözleşmeyi kabul etmezse alternatifler: aynı modelin başka bir bulut sağlayıcısı üzerinden, o sağlayıcıyla imzalanan sözleşmeyle kullanımı, veya hassas akışlar için Türkiye'de barındırılan açık modeller. Bu alternatifler doğruluk/maliyet ödünleşimiyle birlikte değerlendirilmelidir.

---

## 3. Model seçimi ve proje başına yapay zekâ maliyeti

| Görev | Model | Ayar | Gerekçe |
|---|---|---|---|
| Talep ayıklama (TR/EN/RU) | `AI_MODEL` (varsayılan `claude-sonnet-5-5`) | Yapılandırılmış çıktı (`output_config.format` JSON şeması), `effort: medium` | Çok dilli anlama ve şemaya uyum |
| Belge okuma (PDF, görsel, Excel→CSV) | `AI_MODEL` | `effort: medium`; PDF `document`, görsel `image` bloğu olarak verilir (`AI_ALLOW_BINARY_DOCS`) | Tablo ve çok sayfalı teklifler |
| Zor/kritik belge ikinci okuma | — | **Henüz uygulanmadı.** Öneri: para alanında uyuşmazlıkta farklı istemle ikinci okuma | Maliyet kontrollü doğrulama (04 §4) |
| Taslak yazma (TR/EN/RU, sahibin üslubu) | `AI_MODEL` | `effort: medium`; sabit sistem istemi önbellekte, üslup örnekleri istekte | Kısa, doğal, kişiye özgü metin |
| Sesli komut niyeti | `AI_MODEL_FAST` (varsayılan `claude-haiku-5-5`) | `effort: low`, kısa çıktı, sunucu tarafı yedek model yok | Çok ucuz, düşük gecikme. Gelen mesaj sınıflandırma henüz yok |
| "Bu projeye sor" | `AI_MODEL` | `effort: low`; yalnızca verilen olgularla, yoksa "Bu konuda veri yok." | §3.7 dürüstlük |
| Aylık üslup özeti, kapanış önerileri | `AI_MODEL` | `effort: low`. Message Batches API **henüz kullanılmıyor** (önerilir, ≈ %50 indirim) | Acil değil |

**Teknik notlar:**

- `ClaudeAiService` mock'a düşmez. Model reddi (`stop_reason: refusal`) için desteklenen modellerde sunucu tarafı yedek model (`fallbacks: "default"`, beta) açıktır; `AI_FALLBACKS=off` kapatır. Ret, aşırı yük, zaman aşımı veya geçersiz JSON tipli `AiError` olarak döner (`refusal`, `overloaded`, `rate_limit` …; SDK `AI_MAX_RETRIES` kadar yeniden dener). API bugün bu hatayı isteğin hatası olarak döndürür; ekip manuel teklif/fatura girişiyle devam eder. Otomatik "güven 0 ile insan doğrulaması kartı" yolu **henüz yok** [Ürün kararı].
- Model kimliği yapılandırmadan okunur. Model değişikliği doğruluk test setinden geçmeden yayına alınmaz (04 §3).

**Maliyet (varsayım) [Doğrulanmalı]:** Tipik kazanılan proje başına **≈ $1–1,5** (×1,3 payla ≈ $2; ≈ €0,9–1,9), büyük kongrede **≈ $3–5**, kaybedilen talepte **≈ $0,5–1**. Ayda 30 talepte **≈ €20–50**, büyük kongre ve yoğun "sor" kullanımıyla ≈ €100. Fiyat varsayımı Sonnet 5.5 $2 / $10 per MTok (giriş/çıkış). Ana sürücüler: tedarikçi PDF okuma, sözleşme okuma, "Bu projeye sor"; kaldıraçlar: effort, acil olmayan okumada Batch API, istem önbelleği. Ayrıntılı hesap: [05-faz1-teknik-plan.md §7](05-faz1-teknik-plan.md).

---

## 4. Mikro Yazılım (e-portal) entegrasyonu

**Kısa cevap:** Faz 1'de **Excel dışa aktarımı** (yazma yönü, elle içe aktarım) en güvenli yoldur. **Okuma** (fatura, cari) için en iyi kaynak Mikro değil, **e-Fatura UBL-TR XML**'dir. Mikro'nun API veya web servis desteği **ürün ve sürüme göre değişir ve doğrulanmalıdır**.

| Seçenek | Yön | Durum | Değerlendirme |
|---|---|---|---|
| **Excel/CSV içe aktarım şablonu** | Sistem → Mikro (müşteri faturası taslağı, cari hareketler) | Çoğu muhasebe yazılımında var; Mikro'daki ekran ve şablonun **acentanın kullandığı üründe doğrulanması gerekir** | Faz 1 yöntemi. `GET /api/finance/export/mikro` (exceljs). Uygulanan **varsayımsal** şablon (muhasebeciyle doğrulanmalı [Doğrulanmalı]): fatura başına bir satır; sütunlar Evrak Tipi, Cari Kod, Cari Ünvan, Belge No, Tarih (GG.AA.YYYY), Vade, Tutar (matrah), KDV, Toplam, Döviz, Kur, Açıklama; cari kod `120.<müşteri kısa kodu>` (alıcılar), `320.<TEDARİKÇİ ≤12>` (satıcılar), komisyon faturası için `120.K.<tedarikçi>`; fatura tarihine (`meta.issueDate`) göre filtre (`services/finance.ts`). Aktarım her çağrıda canlı üretilir; aktarım izi tablosu (`exports`) henüz yok. Mikro'da kesilen müşteri fatura no `POST /api/finance/customer-invoices` ile geri kaydedilir |
| **e-Fatura / e-Arşiv UBL-TR XML** | Gelen tedarikçi faturaları → sistem (okuma) | GİB standardı. XML; özel entegratör portalından veya Mikro e-portalından indirilebilir [Doğrulanmalı: indirme ve otomasyon imkânı] | Faz 2. Deterministik ayrıştırıcı, %100 doğruluk, LLM maliyeti yok. Uygulandı: `services/ubl-tr.ts` + `POST /api/finance/supplier-invoices` (.xml, AI'sız); ETTN `finance_entries.ubl_uuid` sütununda (tekil) |
| **Özel entegratör API'si** | Gelen e-fatura okuma | Entegratörlerin çoğu web servis sunar; acentanın entegratörü belirlenmeli [Doğrulanmalı] | Faz 2–3. Otomatik fatura çekme |
| **Mikro API / web servis** | Cari, fatura okuma/yazma | Bazı Mikro ürünlerinde servis katmanı olduğu biliniyor; kapsam, lisans ve maliyet **bilinmiyor** [Doğrulanmalı] | Mikro iş ortağı/bayi ile teknik toplantı yapılmalı. Mümkünse Faz 3'te çift yönlü entegrasyon |
| **Doğrudan veritabanı (SQL Server)** | Okuma | Yerel (on-prem) kurulumda teknik olarak mümkün | **Önerilmez:** destek dışı, sürüm kırılganlığı, SaaS'a taşınamaz |

**Okunabilir mi / yazılabilir mi?**

- **Faz 1:** Yazma Excel ile (insan içe aktarır). Okuma yok; tedarikçi faturası PDF/e-posta ile gelir.
- **Faz 2:** Okuma e-Fatura XML ile.
- **API sonrası:** Cari bakiye okuma ve otomatik fatura taslağı yazma. Faturanın Mikro'da **kesilmesi** her durumda muhasebede kalır (PRD kararı).

**Eylem:** 2. haftada acentadan alınacaklar: kullanılan Mikro ürün adı ve sürümü, örnek içe aktarım şablonu, e-fatura entegratörünün adı.

---

## 5. Kanal (OTA / toptancı) fiyatlarına yasal erişim

**Kısa cevap:** Kullanım şartlarını ihlal eden **otomatik sayfa kazıma (scraping) yapılmayacak.** Faz 1'de **manuel giriş yardımı**, Faz 2'de **resmi iş ortaklığı/affiliate API'leri**.

| Yol | Örnek | Not |
|---|---|---|
| **Manuel giriş yardımı (Faz 1)** | `POST /api/channel-prices`. Form, kalemin koşullarını önceden doldurur (tarih, oda tipi, pansiyon, iptal). Ekip kanal sitesinde aynı koşulu arar, fiyatı ve ekran görüntüsünü ekler | Kanıt dosyası, kaynak ve zaman damgası saklanır. Koşul eşleşmesi zorunludur (`conditionsMatch`); aksi halde `evaluateOffer` sonucu "bilmiyorum" olur |
| **OTA affiliate / iş ortaklığı API'leri** | Booking.com Affiliate Partner, Expedia Group (Rapid API / partner programları) | Başvuru ve onay gerekir. API verisinin **iç kıyaslama amacıyla** kullanılmasına şartların izin verip vermediği ayrıca okunmalıdır (çoğu program veriyi son kullanıcıya satış için sunar) [Doğrulanmalı] |
| **Toptancı (B2B) API'leri** | Hotelbeds, WebBeds vb. | Acentanın zaten toptancı sözleşmesi varsa en meşru yol budur: kendi net fiyat erişimi. Ancak toptancı net fiyatı "kamuya açık kanal fiyatı" değildir; §9 mantığında ayrı bir referans türü olarak gösterilmelidir [Ürün kararı] |
| **Üçüncü taraf fiyat veri sağlayıcıları** | Otel fiyat istihbarat / rate shopping servisleri | Veriyi nasıl topladıkları ve lisans şartları hukuken incelenmeli. Lisanslı hizmet alımı kazımadan farklıdır ama sorumluluk zinciri kontrol edilmeli [Doğrulanmalı] |
| ❌ Kendi kazıyıcımız | — | Şart ihlali, IP engeli ve hukuki risk |

**Öneri:** (1) Faz 1'de manuel yardım; hedef, konaklama kalemlerinin %80'inde kanal fiyatı girilmiş olması. (2) Faz 2 başında acentanın mevcut toptancı ilişkileri ve bir OTA affiliate programı için başvuru yapılsın, şartlar avukatla okunsun.

---

## 6. E-posta: kendi adresinden gönderim ve projeye bağlama

**Kısa cevap:** Acentanın sağlayıcısına göre **Gmail API** (Google Workspace) veya **Microsoft Graph** (Microsoft 365), **kullanıcı bazlı OAuth (delegated)** ile. IMAP/SMTP yalnızca son çare.

| Konu | Google Workspace | Microsoft 365 |
|---|---|---|
| Yetkilendirme | Kullanıcı bazlı OAuth 2.0. Acenta tek bir Workspace ise uygulama **"Internal"** tipinde kaydedilir; Google uygulama doğrulaması gerekmez. Alternatif: yönetici onaylı domain-wide delegation (hizmet hesabı), daha geniş yetkidir ve önerilmez | Entra ID uygulama kaydı, delegated izinler (`Mail.Read`, `Mail.Send`, `offline_access`), kiracı yöneticisi onayı (admin consent) |
| Kapsamlar | `gmail.readonly` + `gmail.send` (en az yetki), etiketleme gerekirse `gmail.modify` | `Mail.ReadWrite`, `Mail.Send` |
| Anlık bildirim | `users.watch` → Cloud Pub/Sub → webhook. 7 günde bir yenilenir; `historyId` ile artımlı okuma | Change notifications (subscriptions) → webhook. Süre sınırlıdır ve yenilenir; delta sorgusu |
| Gönderim | `users.messages.send`. Kullanıcının kendi adresinden gider ve "Gönderilmiş"te görünür | `/me/sendMail` |
| **SaaS aşaması** | Herkese açık uygulama + kısıtlı kapsam = **Google doğrulaması + yıllık bağımsız güvenlik değerlendirmesi** gerekebilir [Doğrulanmalı: maliyet ve süre] | Yayıncı doğrulaması (publisher verification) |

**Yazışmayı projeye bağlama (`mail_threads`), öncelik sırasıyla:**

1. **Konu etiketi:** Giden her mailin konusuna proje kısa kodu eklenir (ör. `[PRJ-0042]`). Yanıtlarda korunur.
2. **Başlık zinciri:** Giden mesajın `Message-ID` değeri kaydedilir. Gelen mesajdaki `In-Reply-To` / `References` ile eşleştirilir. Gmail `threadId` / Graph `conversationId` de kullanılır.
3. **Tedarikçi + açık RFQ:** Gönderen adres tedarikçi kartında kayıtlıysa ve tek açık RFQ varsa otomatik bağlanır.
4. **AI önerisi (Haiku):** Bağlanamayan mesaj için aday projeler önerilir. Güven eşik altıysa kullanıcıya "Bu mail hangi projeye ait?" kartı gelir.

- Kişisel mailler: Yalnızca bilinen müşteri/tedarikçi alan adlarından gelen veya proje etiketi taşıyan mailler içe alınır. Kullanıcı "hariç tut" kuralı tanımlayabilir (gizlilik).
- **Kod durumu:** kullanıcı bazlı OAuth gönderimi uygulandı (`EMAIL_PROVIDER=oauth`, `services/email-oauth.ts`, `services/mail-accounts.ts`, migration `016`); **canlı Google / Microsoft hesaplarıyla henüz test edilmedi.** Bağlanan posta kutusu kullanıcının giriş adresiyle aynı olmalı (`MAIL_OAUTH_REQUIRE_SAME_ADDRESS`). Belirteçler `user_mail_tokens` tablosunda pgcrypto ile (`MAIL_TOKEN_KEY`, anahtar DB dışında) saklanır, denetim kaydına girmez. Kullanıcı ayrıldığında hesap `disconnected` yapılır (silinmez), Google belirteci iptal edilir; bağlı olmayan kullanıcı için `EMAIL_OAUTH_FALLBACK` = `smtp` / `outbox` / `hold`. Gelen posta için Gmail `users.watch` / Graph abonelikleri ⛔. [Doğrulanmalı] Gmail'in istemcinin verdiği Message-ID'yi koruduğu; Exchange Online değiştirirse Graph'ın `internetMessageId` değeri saklanır.

---

## 7. WhatsApp Business API

**Kısa cevap:** Kişisel hesap entegre edilemez. **WhatsApp Business Platform (Cloud API)** kullanılmalıdır. Erişim doğrudan Meta üzerinden veya bir **BSP** (iş çözüm sağlayıcısı) aracılığıyla olur.

| Konu | Öneri / bilgi |
|---|---|
| Sağlayıcı | **Doğrudan Meta Cloud API** (ek platform ücreti yok, teknik ekip gerekir) **veya** destek ve panel için bir BSP. Örnekler: 360dialog, Twilio, Infobip, Vonage, yerel TR BSP'leri. Seçim kriterleri: TR desteği, fiyat şeffaflığı, Cloud API uyumu, çoklu acenta (SaaS) için kiracı yönetimi. Faz 1'de doğrudan Cloud API önerilir; SaaS'ta "Embedded Signup" ile her acenta kendi WABA hesabını bağlar |
| Maliyet | Meta, mesaj başı ücretlendirmeye geçti (2025). Müşterinin yazmasıyla açılan 24 saatlik hizmet penceresi içinde serbest metin yanıtlar ücretsizdir. Pencere dışında yalnızca **onaylı şablon** gönderilebilir ve kategoriye (marketing / utility / authentication) ve ülkeye göre ücretlendirilir. **Türkiye tarifesi Meta'nın güncel fiyat tablosundan doğrulanmalıdır.** Acenta hacminde aylık tutar düşüktür (05 §6) |
| Mevcut numara | Numara API'ye taşınabilir. Taşımada numara WhatsApp Business uygulamasından ayrılır ve sohbet geçmişi taşınmaz. Meta'nın "coexistence" özelliği (aynı numarayı hem Business uygulamasında hem Cloud API'de kullanma) bazı ülkelerde sunuluyor; **Türkiye'de kullanılabilirliği ve kısıtları doğrulanmalı.** Alternatif: API için yeni numara, mevcut numarada "yeni numaramız" yönlendirmesi |
| Ön koşullar | Meta Business hesabı doğrulaması (işletme belgeleri), görünen ad onayı, ödeme yöntemi. **2–6 hafta sürebilir**, bu yüzden Faz 1'in ilk haftasında başlatılmalı |
| Şablon onayı | Şablonlar Meta tarafından incelenir (genelde dakikalar ile 1 gün arası). Faz 1 şablonları: eksik bilgi sorusu, teklif hazır (link), opsiyon hatırlatma, saha ekstra onay linki. TR, EN ve RU sürümleri ayrı şablondur |
| Projeye bağlama | Gelen mesaj → `inbound_messages(channel='whatsapp')` → Haiku sınıflandırma. Telefon numarası müşteri kontağıyla eşleşir |
| Kod durumu | Gönderim uygulandı (`MESSAGING_PROVIDER=whatsapp_cloud`, `services/messaging.ts`); **canlı WABA ile test edilmedi.** Pencere dışında yalnız onaylı şablon; pencere içinde (son 24 saatte numaradan gelen mesaj) onaylı taslak metni / etkileşimli buton. Kalıcı hata (ör. WhatsApp kullanıcısı değil) → SMS. Durum webhook'u → `outbox.delivery_status` |
| İnsan imzası | Gönderim yalnızca onaylı taslaktan yapılır. Mesaj acentanın işletme hesabından gider; "kişinin kendi adresi" ilkesi WhatsApp'ta işletme numarası + imza satırında kişinin adı olarak uygulanır [Ürün kararı] |

**Meta şablon onayı — adımlar (canlıya geçmeden önce):**

1. Meta Business hesabı doğrulaması, WABA + telefon numarası, görünen ad onayı; Business Manager → Sistem kullanıcısı → `whatsapp_business_messaging` izinli kalıcı belirteç → `WHATSAPP_TOKEN`; numaranın kimliği → `WHATSAPP_PHONE_NUMBER_ID`; uygulama gizli anahtarı → `WHATSAPP_APP_SECRET`, webhook doğrulama → `WHATSAPP_VERIFY_TOKEN` (`/api/inbound/whatsapp`, alan `messages` — durum bildirimleri de bu alandan gelir).
2. WhatsApp Manager → Mesaj şablonları → oluştur (kategori **Utility**), her dil ayrı şablon (TR / EN / RU; adlar `WHATSAPP_TEMPLATE_*`):
   - `field_extra_approval`: gövde `Merhaba {{1}}, {{2}} etkinliğiniz için "{{3}}" ek hizmeti {{4}}. Onaylıyorsanız aşağıdaki butona dokunun. — {{5}}` (1 müşteri, 2 proje kodu, 3 açıklama, 4 tutar, 5 saha sorumlusunun adı); buton 0 **Hızlı yanıt** "Onaylıyorum" (yük `extra_approve:<token>` gönderimde verilir); isteğe bağlı buton 1 **URL** `https://<alan>/e/{{1}}` → `WHATSAPP_TEMPLATE_FIELD_EXTRA_URL_BUTTON=1`.
   - `quote_reminder`: `Merhaba {{1}}, {{2}} teklifimizin opsiyonu {{3}} tarihinde doluyor. — {{4}}`.
   - `critical_alert` (acentanın kendi yöneticisine): `MICE OS: {{1}} kritik bildirim yanıt bekliyor: {{2}}. Karar kutusu: {{3}}`.
3. Parametre sayısı / buton sırası koddaki ile birebir aynı olmalı (aksi hâlde Meta 132000 hatası verir, mesaj kalıcı hata sayılır ve SMS'e düşer).
4. Onay süresi genelde dakikalar–1 gün; reddedilirse metni sadeleştirip yeniden gönderin [Doğrulanmalı: güncel Meta politikası, TR fiyatı].

**SMS:** `SMS_PROVIDER=http` genel bir TR ağ geçidi (Netgsm REST v2 tarzı JSON) uygular; **seçilecek satıcı (Netgsm / İleti Merkezi / …), istek biçimi, hata kodları, BTK başlık (gönderici adı) kaydı ve İYS gereksinimi doğrulanmalı [Doğrulanmalı]**; farklıysa yalnız `smsRequest` / yanıt ayrıştırma uyarlanır.

---

## 8. Sesli komut: Türkçe konuşma tanıma

**Kısa cevap:** Türkçe STT kullanılabilir düzeydedir. Ancak doğruluk gürültüye ve özel isimlere (semt, otel adı) çok duyarlıdır. Bu nedenle sesli komut **her zaman bir onay kartına** dönüşür; doğrudan eylem yapmaz.

| Seçenek | Artı | Eksi |
|---|---|---|
| Bulut STT (Google Cloud Speech-to-Text, Azure Speech, OpenAI transcribe modelleri, Deepgram, ElevenLabs vb.; `tr-TR` desteği satıcı bazında doğrulanmalı) | Kurulum kolay; bazılarında özel sözlük / phrase hints var | Yurt dışı aktarım (KVKK §2); dakika ücreti |
| Kendi barındırdığımız Whisper sınıfı açık model (ör. large-v3 / turbo) | Veri Türkiye'de kalabilir; çok dilli | GPU maliyeti ve operasyon yükü; düşük hacimde pahalı |
| Tarayıcı Web Speech API | Ücretsiz | Safari/iOS'ta davranış ve veri akışı kontrol edilemez; kalite tutarsız. **Önerilmez** |

**Tasarım:**

1. Basılı tut–konuş (push-to-talk) ile `MediaRecorder` kaydı alınır. `getUserMedia({audio:{noiseSuppression:true, echoCancellation:true, autoGainControl:true}})` ayarları kullanılır.
2. Ses sunucuya gönderilir ve STT çalışır. STT'ye bağlam sözlüğü verilir: acentanın tedarikçi adları, İstanbul semtleri, müşteri adları.
3. `AiService.interpretCommand` (Haiku) niyeti çıkarır; ardından `extractRequest` çalışır.
4. Kullanıcı talep kartını görür, düzeltir ve onaylar.
5. Ses dosyası 30 gün sonra silinmez; anonimleştirilir, yani ses kaldırılır ve yalnızca transkript kalır (silinmezlik + KVKK dengesi).

**Gürültülü ortam:**

- Araç ve saha ortamında kelime hata oranı belirgin şekilde artar. Kesin oran **acentanın kendi kayıtlarıyla ölçülmelidir.**
- Faz 1 sonunda 50–100 gerçek komutluk TR test seti hazırlanmalı (sessiz / araç / kalabalık salon). En az iki STT servisi bu sette kelime hata oranı (WER) ve **varlık doğruluğu** (tarih, kişi sayısı, semt doğru mu) ile kıyaslanmalı.
- İş için WER'den önemli olan varlık doğruluğudur.

**Öneri:** Faz 1 sonunda bulut STT ile pilot yapılsın. KVKK dayanağı STT sağlayıcısı için de kurulmalı. Kullanım düşükse ses özelliği opsiyonel kalsın.

---

## 9. Belge okuma doğruluğu

**Kısa cevap:** Hedef "eşik üstünde kabul edilen para alanlarında ≤ %0,5 hata". Bunun için birleşik güven puanı, alan türü bazında kalibre edilmiş eşik, 12–18 aylık geçmiş belgelerden altın etiketli test seti ve her düzeltmenin öğrenme verisi olarak kaydı öneriliyor. Ayrıntı: [04-dogruluk-olcumu.md](04-dogruluk-olcumu.md).

---

## 10. Tedarikçi linki güvenliği

| Tehdit | Önlem |
|---|---|
| Token tahmini | `crypto.randomBytes(32)`: 256 bit, base64url. Veritabanında yalnızca **SHA-256 özeti** (`public_tokens.token_hash`) tutulur. Düz token yalnızca oluşturma yanıtında ve giden mailde bulunur. Karşılaştırma sabit zamanlıdır (özet indeksi ile) |
| Kapsam aşımı | Token **tek RFQ'ya** bağlıdır: tek kalem × tek tedarikçi. `resolve_public_token` yalnızca o kaynağı döner. Görünüm `PublicRfqView` ile sınırlıdır: proje kodu, kalem, tarih; müşteri adı, bütçe ve başka teklifler yok |
| Süre | Yazma RFQ son tarihine kadar açıktır. Sonra opsiyon süresince **salt okunur**, ardından kapanır (§17.5). Proje kaybedilince, tedarikçi elenince veya iptalde `revoked_at` dolar. Her revizyon yeni teklif sürümüdür |
| Kötüye kullanım | Token ve IP başına rate-limit (`@fastify/rate-limit`, ör. dakikada 30 istek, saatte 10 gönderim). Dosya yükleme sınırları: tür beyaz listesi PDF/XLSX/PNG/JPG, ≤ 20 MB, içerik türü (magic bytes) kontrolü, virüs taraması (ör. ClamAV). Formda bot koruması (honeypot alanı; gerekirse görünmez CAPTCHA) |
| Token sızması | Bağlantıya sahip olan herkes yanıt verebilir. Bu kabul edilen risktir ve şöyle sınırlandırılır: dar kapsam, kısa süre, her gönderimin IP/user-agent kaydı, tedarikçiye "yanıtınız alındı" bilgilendirmesi (beklenmeyen yanıt fark edilir). Yüksek riskli durumda ekip linki tek tıkla yenileyebilir |
| Referer / log sızıntısı | `Referrer-Policy: no-referrer`. Token URL **fragment** (`#`) kısmında taşınır ve sunucu loglarına düşmez; istemci token'ı `Authorization` başlığıyla gönderir. Sayfada üçüncü taraf script yoktur |
| **Phishing (oltalama)** | (1) RFQ mailleri yalnızca sorumlu kişinin **kendi kurumsal adresinden** gider (SPF/DKIM/DMARC acenta alan adında `p=quarantine` veya `reject`). (2) Link **acentanın kendi alt alan adını** kullanır (ör. `teklif.acenta.com.tr`); SaaS'ta her acenta için özel alan adı (CNAME + TLS) kullanılır. (3) Sayfa acenta logosu, proje kodu ve **sorumlu kişinin adını** gösterir. (4) Form **asla** parola, banka veya kart bilgisi istemez; bu bilgi her RFQ mailinin altında açıkça yazar. (5) Link kısaltıcı kullanılmaz. (6) Tedarikçiye ilk RFQ'da "linklerimiz yalnızca bu alan adından gelir" notu eklenir |
| Güvenlik başlıkları | Sıkı CSP, HSTS, `X-Frame-Options: DENY`, `noindex` |

Aynı kalıp müşteri teklif onayı, rooming list, saha ekstra onayı ve anket linkleri için de geçerlidir (`public_tokens.purpose`).

---

## 11. Çok kiracılı izolasyon: RLS test stratejisi

**Kısa cevap:** Savunma üç katmandır: (1) tüm tablolarda `FORCE ROW LEVEL SECURITY` + işlem kapsamlı `app.tenant_id`; (2) uygulama rolünde `BYPASSRLS` yok; (3) **CI'da her commit'te çalışan 10 katmanlı test.** Testler katalog kapsamı, SQL ve API düzeyinde çapraz erişim, bağlamsız sorgu, bağlantı havuzu eşzamanlılığı, worker, AI istem içeriği ve özellik tabanlı testleri içerir. SaaS öncesinde bağımsız sızma testi yapılır. Her sürümde "İzolasyon raporu" üretilir. Ayrıntı: [02-veri-modeli.md §4 ve §7](02-veri-modeli.md).

---

## 12. Otomasyon terfisi

**Kısa cevap:** İş türü bazında `automation_counters` (mod, ardışık temiz onay, eşik 20, örneklem oranı 0,05) ve değişmez `automation_events` günlüğü. Dış mesajlarda örneklem **göndermeden önce** denetlenir. Hata bulunduğunda sistem kendiliğinden onay moduna döner ve bildirim gönderir. Yasak liste veritabanı `CHECK` kısıtıyla da engellenir. Ayrıntı: [06-otomasyon-terfisi.md](06-otomasyon-terfisi.md).

---

## 13. Değişiklik yayılımı: bağımlılık modeli

**Kısa cevap:** İki katmanlı model kullanılır.

- **Statik harita** (`DOCUMENT_DEPENDENCIES` / `staleKindsFor`): Düzenleme öncesi etkiyi gösterir.
- **Kesin bağımlılık kaydı** (`document_dependencies`): Belge üretilirken okunan her varlığın kimliği, sürümü ve alan özeti yazılır.

Kaynak tablolardaki tetikleyici bağlı belgeleri `stale` yapar. Gönderim ve imza uç noktaları, belge `current` değilse veya özetler uyuşmazsa `409` döner. Yeniden üretim yeni sürüm ekler ve fark özetini (`changeImpact`) karar kartına koyar. Ayrıntı: [02-veri-modeli.md §6](02-veri-modeli.md).

---

## 14. Yedekleme, süreklilik ve veri merkezi konumu

| Hedef | Faz 1 (tek acenta) | SaaS (Faz 3) |
|---|---|---|
| **RPO** (kabul edilebilir veri kaybı) | ≤ 15 dk (sürekli WAL arşivi, PITR) | ≤ 5 dk + senkron/yarı-senkron bekleme sunucusu |
| **RTO** (geri dönüş süresi) | ≤ 4 saat | ≤ 1 saat |
| **Erişilebilirlik** | %99,5 aylık (yaklaşık 3,6 saat/ay kesinti payı); bakım mesai dışında | %99,9 |
| Yedek planı | Günlük tam yedek 35 gün, aylık 12 ay saklanır. Şifreli. **Farklı bölge/sağlayıcıya** kopya. Nesne deposunda sürümleme ve silme koruması (object lock) | Aynı + bölgeler arası replika |
| Doğrulama | **Üç ayda bir geri yükleme tatbikatı**; süre ölçülür ve raporlanır | Aylık otomatik geri yükleme testi |
| Gizli anahtarlar / KMS | Şifreleme anahtarlarının yedeği ayrı yerde. Anahtar kaybı = veri kaybı | HSM/KMS, çift kontrol |

**Veri merkezi konumu:**

| Seçenek | Artı | Eksi |
|---|---|---|
| **Türkiye'de** (yerli bulut veya veri merkezi sağlayıcıları; ör. Turkcell, Türk Telekom, KoçSistem grubu hizmetleri; uluslararası sağlayıcıların TR bölgeleri) [Doğrulanmalı: yönetilen PostgreSQL 16, PITR ve fiyat] | Ana veri yurt dışına çıkmaz. KVKK riski ve müşteri algısı açısından en güçlü konum. Yurt dışı aktarım yalnızca AI ve iletişim sağlayıcılarıyla sınırlı kalır | Yönetilen hizmet olgunluğu ve fiyat değişken; operasyon yükü artabilir |
| AB bölgesi (ör. Frankfurt) | Olgun yönetilen hizmetler | **Tüm veri** yurt dışına aktarılmış olur. Kapsamlı standart sözleşme süreci gerekir |

**Öneri:** Ana veritabanı ve nesne deposu **Türkiye'de** tutulsun; yedek kopya da Türkiye'de farklı bir sağlayıcı veya bölgede olsun. Yurt dışına çıkan tek akış, takma adlandırılmış AI çağrıları ve iletişim API'leri (Gmail/Graph, WhatsApp) olsun; bunlar standart sözleşmeyle kapsansın. Uygulama konteynerleştirildiği için sağlayıcı değişimi mümkündür. Sağlayıcıya özgü servis kullanılmaz.

---

## 15. Rıza yönetimi (misafir verisi)

**Toplama** (rooming list online formu, `public_tokens.purpose='rooming'`):

- Aydınlatma metni ile açık rıza **ayrı ayrı** sunulur (KVKK pratiği: rıza aydınlatmaya gömülmez).
- Kutu **varsayılan işaretsizdir.** Metin: "Bilgilerimin sonraki etkinliklerde kullanılmasına izin veriyorum." Metnin kesin içeriğini avukat belirler.
- Rıza, **form doldurulmasının ön koşulu değildir.** Rıza vermeyen misafir de rooming list'e girer (hizmet için gerekli işleme farklı bir hukuki dayanağa dayanır [Doğrulanmalı]).
- Excel ile gelen listede rıza bilgisi yoktur. Sistem bu misafirlere (e-posta varsa) kişisel rıza linki gönderebilir; yoksa `consent_reuse=false` kabul edilir.

**Saklama:**

- `guests.consent_reuse`, `consent_at`, `consent_text_version`, `consent_channel` alanları.
- Değişmez `consent_events` kaydı: IP özeti, user-agent, metin sürümü.
- Metinler `consent_texts` tablosunda sürümlüdür.

**Geri alma:**

- Her bilgilendirme mailinde ve rıza onay ekranında kişiye özel **geri alma linki** bulunur (`POST /api/public/consent/:token/withdraw`).
- Ekip de kayıt üzerinden geri alma işleyebilir (telefonla gelen talep).
- Geri almada `consent_withdrawn_at` dolar ve veri, yasal saklama süresi bitiminde (veya geçmişse hemen) anonimleştirilir (`domain.shouldAnonymize`). Yeniden kullanım havuzundan hemen çıkar.

**Otomatik anonimleştirme:**

- Gece çalışan worker işi `retention_until < bugün AND (NOT consent_reuse OR consent_withdrawn_at IS NOT NULL) AND anonymized_at IS NULL` koşulunu sağlayan kayıtları bulur. Bu kayıtlarda şifreli PII alanları ve kör indeksler `NULL` yapılır, `anonymized_at` doldurulur ve `consent_events('anonymized')` yazılır.
- Oda tipi ve tarihler istatistik için kalır.
- `retention_until = retentionUntil(etkinlik bitişi, rules.guestDataRetentionDays)`. Süre kural tablosundan okunur; avukat belirleyecektir. Varsayılan 730 gün **yalnızca yer tutucudur.**
- Audit log PII değeri tutmaz (`audit_redact`). Yedeklerdeki kopyalar yedek saklama süresi (≤ 12 ay) dolunca kendiliğinden düşer; bu durum aydınlatma metninde belirtilir.
- Yeniden kullanım: Yeni etkinlikte isim veya e-posta kör indeksiyle eşleşen ve **rızası geçerli** olan misafirin bilgileri önerilir. Rızasız kayıt önerilmez.

---

## 16. Saha paneli çevrimdışı çalışma

**Kısa cevap:** **Evet**, PWA ile. Saha kayıtları ekleme-temelli (append-only) olduğu için çakışma riski düşüktür.

| Bileşen | Tasarım |
|---|---|
| Uygulama kabuğu | Service Worker (Workbox), önbellek-öncelikli (cache-first) |
| Etkinlik günü verisi | Saha sorumlusu "Bugünün etkinliği" ekranını açtığında proje özeti, kontrol listesi, kontaklar, program ve limitler IndexedDB'ye indirilir. Misafir PII'si yalnızca `field` rolü yetkiliyse ve şifreli indirilir; gün sonunda silinir |
| Çevrimdışı kayıt | Kontrol listesi işareti, sorun kaydı, ekstra harcama (+ fotoğraf). Her kayda istemcide `offline_client_id` (UUID v7) verilir ve **outbox** (IndexedDB) kuyruğuna yazılır |
| Senkronizasyon | iOS'ta Background Sync API olmadığı için şu anlarda yapılır: `online` olayı, uygulama ön plana geldiğinde (`visibilitychange`) ve açıkken 60 saniyelik periyotla. Sunucu `offline_client_id` alanında unique kısıtla **idempotent** kabul eder |
| Çakışma | Saha kayıtları yalnızca eklenir, yani çakışmaz. Kontrol listesi durumunda "son işaretleyen kazanır" kuralı geçerlidir ve her işaret audit'e yazılır |
| Ekstra harcama limiti | Çevrimdışıyken limit kontrolü **yerel önbellekteki** proje toplamıyla yapılır (`fieldExtraNeedsAdmin`). Senkronizasyonda sunucu tekrar kontrol eder; limit aşılmışsa `field_extra` kararı açılır ve saha sorumlusu bilgilendirilir. **Müşteri onay linki (SMS/WA) çevrimiçi olunca gönderilir.** Acil durumda müşteri temsilcisinin imzası/onayı cihazda fotoğraf olarak alınabilir [Ürün kararı] |
| Depolama | `navigator.storage.persist()` istenir. Safari'nin site verisini temizleme politikası ana ekrana eklenmiş uygulamada farklı davranır, bu yüzden ana ekrana ekleme zorunludur [Doğrulanmalı: güncel iOS davranışı] |
| Kullanıcıya görünürlük | Başlıkta "Çevrimdışı — 3 kayıt bekliyor" rozeti. Bekleyen kayıt varken oturum kapatılamaz |

PRD'de saha paneli Faz 2'dedir. Çevrimdışı mod Faz 2'nin ilk işi olarak planlanmalıdır.

---

## 17. Maliyet ve takvim

**Kısa cevap:**

- **Faz 1:** 18–22 hafta, yaklaşık 4,3 TZE (75–95 kişi-hafta).
- **Geliştirme:** Varsayımla ≈ €70–190 bin.
- **Aylık işletme (tek acenta):** ≈ €140–750, bunun içinde yapay zekâ ≈ €20–100.
- **Proje başına AI:** tipik kazanılan proje ≈ $1–1,5 (≈ €0,9–1,4; ×1,3 payla ≈ €1,9), büyük kongre ≈ $3–5 [Doğrulanmalı].
- **SaaS'ta acenta başı marjinal maliyet:** ≈ €80–480/ay.

Ayrıntı ve varsayımlar: [05-faz1-teknik-plan.md](05-faz1-teknik-plan.md).
