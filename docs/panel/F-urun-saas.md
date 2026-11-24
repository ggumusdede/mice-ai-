# Komite F — Ürün, SaaS ve Teknoloji

> Kaynaklar: `panel/BRIEF.md`, `docs/README.md` (Uygulama durumu), PRD v0.4 §11–14. Kod okunmadı; teknik durum yalnız durum tablosundan alındı.
> Pazar rakamları, fiyatlar ve üçüncü taraf yetenekleri **tahmin/aralık** olarak verilmiştir ve **[Doğrulanmalı]** işaretlidir. Kesin rakam iddiası yoktur.

---

## 1) Katılımcılar

| Kod | Rol | Bakış açısı |
|---|---|---|
| **ÜM** | SaaS Ürün Müdürü (B2B dikey SaaS, 12+ yıl) | Paketleme, yol haritası, aktivasyon metrikleri |
| **YZ** | Yapay Zekâ Uzmanı (LLM ürünleri, değerlendirme/kalibrasyon) | Gerçekçi yetenek sınırları, halüsinasyon, güven puanı, maliyet |
| **BG** | Bilgi Güvenliği Uzmanı (ISO 27001 baş denetçi geçmişi) | Kiracı izolasyonu, kimlik, KVKK teknik tedbirler, yurt dışı aktarım |
| **FİM** | Fiyatlandırma & İş Modeli Uzmanı | Abonelik kurgusu, TRY/EUR, CAC/LTV, Türkiye ödeme gücü |
| **SA** | Sektör Analisti (turizm teknolojileri, MICE) | TÜRSAB yapısı, rakipler, pazar büyüklüğü, dijitalleşme |
| **EM** | Entegrasyon Mimarı | GDS/NDC, bedbank, muhasebe, e-Fatura, WhatsApp, e-posta |
| **MD** | Müşteri Destek & Onboarding Lideri | Kurulum süresi, veri taşıma, eğitim, terk riskleri |
| **BA** | **Dış ses:** 6 kişilik butik MICE acentası sahibi (yılda ~40–60 proje, Excel + WhatsApp + muhasebeci) | "Bu bana ne kazandırır, kaça, ne kadar sürede öğrenirim?" |

Moderatör notu: Toplantı beş ana tur + bir kapanış turu olarak yürütüldü. Her öneri BRIEF'teki "Değişmez mimari" (1–9) listesine karşı kontrol edildi.

---

## 2) Tartışma tutanağı

### Tur 1 — Ürünün sektöre satılabilirliği: 10 hedef ve mevcut durum

**ÜM** açılışı yaptı: "Elimizde nadir bir şey var: rakiplerin çoğu *etkinlik* yazılımı (kayıt, bilet, mobil uygulama, katılımcı deneyimi), biz ise *acentanın tedarik–teklif–marj–tahsilat zinciri* için yazılımız. 0–8 adımın tamamı testli ve uçtan uca çalışıyor. 10 hedefin en az 7'sine doğrudan dokunuyoruz: takip (1), hata (2), hız (3), sisteme bağlı kontrol (6), kurum hafızası (7), fiyat değişkenliği (8), hesap/kârlılık (10). Hedef 4 (tedarikçi ilişkisi) ve 5 (güvenilir irtibat) kısmen; hedef 9 (yazışma analizi) zayıf — 'Bu projeye sor' kısmi." Ama satılabilirlik açısından "ürün tek acentaya göre olgun, SaaS olarak *açılmamış*" dedi: kayıt, abonelik, faturalama, onboarding, SSO, nesne deposu, veri dışa aktarımı yok.

**SA** pazarı çerçeveledi: "TÜRSAB'a kayıtlı acenta sayısı on binler mertebesinde [Doğrulanmalı], ama bunların içinde *düzenli MICE işi yapan* kesim küçük — birkaç yüz ile birkaç bin arası bir çekirdek olduğunu tahmin ediyorum [Doğrulanmalı]. Buna kongre organizatörleri (PCO), DMC'ler ve kurumsal seyahat yönetim şirketlerinin etkinlik birimleri eklenir. Yani bu bir *hacim* pazarı değil, *değer* pazarı. Dijitalleşme seviyesi düşük: tipik araç seti Excel, WhatsApp grupları, e-posta, bir ön muhasebe/muhasebe programı ve yaygın biçimde bir tur operatörü/rezervasyon yazılımı [Doğrulanmalı]." Rakipler hakkında: "Cvent, Bizzabo, Eventsforce gibi küresel oyuncular katılımcı kaydı, etkinlik sitesi, mobil uygulama, mekân kaynak bulma (Cvent'in tedarik tarafı güçlü) gibi alanlarda; fiyatları ve kurgu olarak Türkiye'deki butik acentanın ödeme gücünün çok üstündeler ve Türk muhasebe/e-Fatura gerçeğini bilmiyorlar [Doğrulanmalı]. Yerli acenta yazılımları ağırlıkla tur/otel rezervasyonu ve ön muhasebe odaklı; 'AI ile tedarikçi teklifi okuyup marjı koruyan, karar kutusu olan' bir rakip görmedim [Doğrulanmalı — rakip taraması yapılmalı]."

**BA** ilk tepkisini verdi: "Güzel konuşuyorsunuz ama ben üç şey soracağım. Bir: benim bir operasyon kızım ayda kaç saat kazanır? İki: ayda kaç para? Üç: benim 50 yaşındaki ortağım bunu kaç günde kullanır? Ben Cvent'i bilmem, benim rakibim Excel ve WhatsApp. Excel bedava."

**YZ** gerçekçi bir çerçeve çizdi: "Talep ayıklama, tedarikçi teklifi okuma, fatura okuma — bunlar bugünkü LLM'lerin iyi yaptığı işler; ama 'iyi' %100 değil. Elimizdeki değerlendirme seti **sentetik** 25 belge; gerçek etiketli set yok, Claude ile ölçüm yok, CI kapısı yok. Satışta '%98 doğruluk' gibi bir rakam söylersek yalan söylemiş oluruz. Söyleyebileceğimiz şey: *her alan güven puanıyla gelir, düşük puanlı alan insana sorulur, AI hiçbir parayı hareket ettirmez, hiçbir mesajı onaysız göndermez.* Bu, sektörün 'AI'ya güvenmiyorum' itirazına doğru cevap."

**BG** iki kırmızı bayrak kaldırdı: "(1) Sesli not şu an tarayıcının Web Speech API'siyle çalışıyor. Chrome'da bu ses çoğunlukla üreticinin sunucularına gider [Doğrulanmalı]. Yani ses kaydı — içinde müşteri adı, telefon, belki misafir adı — bizim kontrolümüz dışında yurt dışına çıkıyor olabilir. Bu, ilke 9 açısından açık bir risk. (2) SaaS için SSO yok, yenileme belirteci yok, nesne deposu yok; destek ekibinin kiracı verisine nasıl, kimin onayıyla erişeceği tanımlı değil. Çok kiracılı RLS çok iyi kurulmuş, ama 'platform operatörü' rolü henüz tasarlanmamış."

**EM** entegrasyon gerçekliğini koydu: "Durum tablosunda en dürüst satırlar şunlar: Gmail/Graph OAuth, WhatsApp Cloud API, SMS — *uygulandı, canlı hesapla test edilmedi.* SaaS'ta bunların her biri bir sertifikasyon/onay süreci demek. Gmail'de okuma kapsamları 'kısıtlı kapsam' sınıfında, çok kiracılı yayında Google doğrulaması ve yıllık bağımsız güvenlik değerlendirmesi gerekebilir [Doğrulanmalı]. WhatsApp'ta her acentanın kendi numarasını bağlaması için Meta'nın Embedded Signup / teknoloji sağlayıcı süreci gerekir [Doğrulanmalı]. Bunlar yazılım değil, *takvim* riski."

**MD** onboarding gerçeğini anlattı: "Bu ürünün öğrenme yükü 9 adım, karar kutusu, yetki seviyeleri, kurallar tablosu. Büyük DMC için bu artı; butik için korkutucu. İlk veri yükü (18 ay, elle doğrulama) teknik olarak var, ama butik acentanın verisi Excel'lerde, e-postalarda, kafada. 'Önce verini taşı, sonra değer gör' dersek butik müşteriyi ikinci haftada kaybederiz."

**FİM**: "Türkiye'de SaaS fiyatlamanın üç gerçeği: yüksek enflasyon ve kur oynaklığı; KOBİ'nin aylık abonelikten çok yıllık peşin indirime ve 'tek seferlik' paraya alışık olması; ve kurumsal tarafın EUR bazlı düşünmesi. İç para birimimiz zaten EUR — fiyat listesini de EUR bazlı, TL'ye fatura günü kuruyla çevrilen bir yapıda kurmak ürünle tutarlı olur."

**ÜM** turu, 1. turun gündemini 13 başlıkta topladı: modüler paket, onboarding süresi, veri taşıma, çok dil/çok para birimi, white-label, mobil, AI maliyeti, AI güveni, veri sahipliği/dışa aktarım, API/pazaryeri, uptime/SLA, KVKK + yurt dışı aktarım, rekabet farkı.

### Tur 2 — Butik acenta sahibi ile ürün müdürü karşı karşıya; paketleme ve değer

**BA**: "Ben 9 adımın hepsini istemiyorum. Bana talebi okuyup tedarikçilere RFQ atan, teklifleri yan yana koyan ve 'şu marjla satarsan zarar etmezsin' diyen bir şey lazım. Sözleşme farkı, banka ekstresi eşleştirme, otomasyon terfisi… bunlar büyükler için."

**ÜM**: "Tam tersini savunacağım: sizin en çok para kaybettiğiniz yer büyük ihtimalle teklif değil, **kapanış**. Faturası gelmemiş ödeme, unutulan ekstra, tahsil edilmemiş fark. Hedef 10. Bunu bir çekirdeğe koymazsak 'teklif yazılımı' oluruz, ki o pazar ucuz ve kalabalık."

**FİM** uzlaştırıcı bir kurgu önerdi: "Çekirdek = **0–8 akışın tamamı ama sade modda**. 'Sade mod' bir ürün kararı: aynı veri modeli, aynı onay kapıları, ama arayüzde gelişmiş adımlar (ek protokol, otomasyon terfisi, kural önerisi, banka eşleştirme) varsayılan kapalı ya da 'tek ekran' hâlinde. Ücretlendirmeyi *özellik kısarak* değil, *ölçek ve modülle* yapalım. Çünkü çekirdeği kırparsak 'tek doğru kaynak' bozulur: sözleşme modülünü almamış bir acentada teklif–sözleşme farkı nereden kontrol edilecek?"

**BG** burada bir mimari not düştü: "Paket/modül yetkisi (entitlement) `rules` tablosuna konmamalı. Kurallar *acentanın yöneticisinin* değiştirdiği iş eşikleridir (ilke 8). Abonelik yetkisi ise *platformun* verdiği haktır; yönetici onu değiştirememeli. Ayrı bir `tenant_entitlements` tablosu — RLS'li, kiracı okuyabilir ama yazamaz — doğru yer." Herkes katıldı; bu ana çatıyla uyumlu, eklemeli bir değişiklik.

Modül listesi üzerinde uzun tartışma oldu. **SA**: "Bilet modülü bizim için kritik görünüyor ama dikkat: MICE acentalarının önemli bir kısmı bileti ya kendi IATA/BSP yetkisiyle bir GDS ekranından keser, ya da bir konsolidatörden alır [Doğrulanmalı]. GDS entegrasyonunu biz yazarsak sertifikasyon, sözleşme ve sürekli bakım yükü var." **EM**: "Amadeus/Sabre/Travelport ile doğrudan entegrasyon tipik olarak ticari sözleşme + sertifikasyon + işlem başı ücret demek, aylar sürer [Doğrulanmalı]. NDC tarafında havayolu bazlı farklılıklar var. v0.5'te gerçekçi olan: **bilet modülü = PNR/bilet kaydı ve takip katmanı** (TKT time limit, isim listesi, ücret kuralı notu, bilet numarası, iade/değişiklik durumu) + GDS/konsolidatör raporlarının **içe aktarımı** (CSV/e-posta). Kesmeyi biz yapmayalım." **YZ**: "Ve TKT time limit bir *son tarih*; AI'nın 'bilet kes' yetkisi zaten yok, olmamalı — konfirmasyon yasak listesinde. Biz uyarı ve karar kartı üretiriz."

**BA** araya girdi: "Transfer benim her işimde var. 120 kişiyi havalimanından otele taşıyorum, uçuş rötar yapıyor, şoför telefonu açmıyor. Bilet değil, transfer modülü önce gelsin." **MD** destekledi: "Saha tarafındaki destek çağrılarının en büyük kaynağı transfer olacak; bu, günlük kullanım alışkanlığı da yaratır." **ÜM** not aldı: "Transfer hafif modülü (araç planı, karşılama listesi, uçuş no + saat, şoför/araç ataması, saha checklist'i) v0.5 adayı; uçuş takip API'si sonra."

**Kongre kayıt** konusunda **SA**: "PCO'lar için katılımcı kaydı, yaka kartı, abstract yönetimi ayrı bir ürün dünyası; küresel rakiplerin güçlü olduğu yer tam burası. Biz bunu yeniden yazmak yerine bir kayıt platformuyla entegre olabiliriz ya da çok sade bir 'kayıt formu → rooming listesi' köprüsü yapabiliriz." **BG**: "Kongre kaydı demek binlerce katılımcının PII'si demek; bizim 'misafir verisi şifreli, rıza bazlı, modele gönderilmez' ilkemiz burada ölçekle sınanır. Sade köprü — evet; tam kayıt platformu — Faz 3 ve ayrı DPIA ile."

**CRM**: **ÜM** "Pipeline olmadan yönetici 'kaç teklif açık, ne kadar ciro bekliyorum' sorusunu cevaplayamaz. Ama elimizde zaten talepler, teklifler, kayıp nedenleri, müşteri karar süreleri var — *CRM-lite* bir görünüm %70'i karşılar." **BA**: "Ben CRM için ayrı para vermem." **FİM**: "Vermeyeceksiniz; CRM-lite çekirdekte, tam CRM (kampanya, segment, NPS) üst pakette."

**Finans entegrasyonları**: **EM** "Mikro Excel aktarımı var ama sütunlar *varsayım*. Sektörde Logo (Tiger/Go), Netsis, Luca, Paraşüt, Mikro yaygın [Doğrulanmalı — müşteri anketiyle sıra belirlenmeli]. Muhasebecisi dışarıda olan butik için en değerli şey 'muhasebeciye ay sonu temiz Excel/CSV + e-Fatura XML paketi'. API entegrasyonları ikinci aşama." **BA**: "Evet. Benim muhasebecim yazılım değiştirmez. Ona tertemiz bir dosya verin yeter."

### Tur 3 — AI'nın dürüst sınırları ile satış vaatleri; AI maliyeti

**ÜM**: "Satış sunumunda 'AI yazışmaları analiz edip müşterinin bütün sorularını doğru, tutarlı, eksiksiz cevaplar' diyebilir miyiz? Hedef 9 bu."

**YZ** sert itiraz etti: "Hayır. Diyebileceğimiz şu: *'Sistem, projenin tüm yazışmalarını ve belgelerini tarar; her cevabı kaynağına (hangi e-posta, hangi sözleşme maddesi, hangi teklif revizyonu) bağlar; kaynaklar çelişiyorsa çelişkiyi gösterir; kaynak yoksa 'bilmiyorum' der.'* Bu kurgu halüsinasyonu ortadan kaldırmaz ama **doğrulanabilir** kılar. Kaynaksız cümle üretmeyen bir yanıt formatı — her iddia bir alıntıya bağlı — ürün kararı olarak zorunlu olmalı. Ayrıca 'eksiksiz' iddiası için bir *soru-takip listesi* gerekir: müşterinin yazışmada sorduğu her soruyu ayıklayıp 'cevaplandı / cevaplanmadı / çelişkili' olarak işaretlemek. Bu, LLM'in gerçekten iyi yaptığı bir iş ve hedef 9'a en yakın dürüst ürün."

**BA**: "Yani yine ben mi okuyacağım?" **YZ**: "Siz okumayacaksınız, *kontrol edeceksiniz*. 40 e-postayı değil, 6 açık soruyu ve 2 çelişkiyi. Zaman kazancı orada."

**BG**: "Yazışma analizi müşteri kişilerinin adlarını, e-postalarını içerir. Misafir verisi modele gitmiyor, ama *müşteri irtibat kişisi* de kişisel veri. PII maskeleme metinde var, PDF/görselde yok (durum tablosu bunu açıkça söylüyor). Sözleşme PDF'i modele giderken içindeki imza yetkilisinin adı, TC kimlik no, IBAN maskelenmeden gidiyor olabilir. SaaS'ta bu *her acentanın* verisi demek."

**YZ**: "Kabul. İki önlem: PDF'ten önce metin çıkarımı + maskeleme (OCR sonrası), görsel olarak gönderilmesi zorunlu belgeler için kiracı düzeyinde 'görsel gönderim izni' kuralı. Ve Anthropic tarafında veri saklama/eğitim politikasının sözleşmeyle teyidi [Doğrulanmalı]."

**Güven puanı** tartışması: **YZ** "Modelin kendi söylediği 'eminim' puanı kalibre değildir. Bizdeki eval koşucusu ECE ve eşik önerisi üretebiliyor — bu çok iyi — ama yalnız sentetik veride. SaaS'a açılmadan önce: pilot acentanın gerçek düzeltmelerinden (export-eval-set zaten var) en az birkaç yüz alanlık maskeli set ve alan türü bazlı eşik (tutar, tarih, kişi sayısı farklı eşik) gerekir. Kiracıya özel kalibrasyon da gerekebilir; bir DMC'nin İngilizce teklifleri ile butik acentanın WhatsApp mesajları aynı dağılım değil." **ÜM**: "Bunu satış argümanına çevirelim: *'Sistem sizin düzeltmelerinizle her hafta size özel kalibre olur; haftalık raporda doğruluk eğrinizi görürsünüz.'*" **YZ**: "Ancak eğri gerçekten ölçülürse. Ölçülmeden grafik koymayın."

**Sesli asistan**: **BA** "Ben arabada sesli not atarım, yazmam." **YZ** "Sesli not → metin → talep ayıklama zinciri değerli. Ama 'sesli asistan' (sisteme sesle komut verme, 'şu teklifi onayla') farklı: onay kapıları Face ID istiyor, bu doğru; sesli komutla para/sözleşme onayı **asla**. Sesli asistan yalnız *okuma ve taslak* yapmalı: 'bugün bekleyen kararlarım ne', 'PRJ-0042'nin opsiyonu ne zaman bitiyor'." **BG**: "Ve STT sunucu tarafına alınmalı; sağlayıcı seçimi veri yerleşimine göre yapılmalı. O zamana kadar Web Speech varsayılan *kapalı*, açıkken kullanıcıya 'ses üçüncü taraf hizmetine gider' uyarısı."

**AI maliyeti vs fiyat**: **FİM** sordu: "Proje başı AI maliyeti nedir?" **YZ**: "Kaba bir kurgu: bir projede 1 talep ayıklama, 3–5 tedarikçi teklifi okuma (PDF, birkaç sayfa), 2–3 pazarlık/müşteri taslağı, 1 sözleşme okuma ve fark, 5–20 fatura okuma, günlük özetler, birkaç 'projeye sor' sorgusu. Hafif işler küçük modelde, belge okuma orta modelde. Bu, proje başına *onlarca* model çağrısı ve büyük belgelerde yüz binlerce token mertebesi demek. Güncel liste fiyatlarıyla proje başına maliyet bence **birkaç EUR ile birkaç on EUR** aralığında, yoğun yazışmalı büyük kongrede daha yüksek [Doğrulanmalı — pilot verisiyle ölçülmeli]. Önbellekleme (proje bağlamı) ve deterministik okuyucular (UBL-TR XML okuma zaten AI'sız) maliyeti ciddi düşürür." **FİM**: "O zaman AI maliyeti abonelik fiyatının küçük bir yüzdesi; ama *uç kullanıcı* riski var: 2.000 katılımcılı kongrede 'projeye sor'u günde yüz kez çalıştıran bir PCO. Çözüm: pakete dahil aylık AI kredisi + adil kullanım + ölçüm. Proje başı ücreti AI maliyetine bağlamayalım, ama ölçmeden de satmayalım." **ÜM**: "AI kullanım ölçümü (kiracı × işlem türü × token × maliyet) v0.5'te P1. Ölçemediğimiz şeyi fiyatlayamayız."

**BA**: "AI kredisi bitince ne olacak, sistem duracak mı?" **YZ**: "Durmamalı. Bizim büyük avantajımız: deterministik mock ve kurallar motoru var; AI kapalıyken de iş akışı, onaylar, belgeler, hesaplar çalışır — sadece okuma/ayıklama elle yapılır. Bunu 'AI'sız da çalışan sistem' diye satmak, AI'ya güvenmeyen sektöre en güçlü mesaj." Herkes bu cümleyi kararlar arasına aldı.

### Tur 4 — Güvenlik vs kolaylık; entegrasyon gerçekliği vs yol haritası; veri sahipliği

**BA**: "Her ödeme onayında Face ID istiyorsunuz. Ben sezonda günde 30 ödeme onaylıyorum." **BG**: "Toplu onay: tek Face ID ile seçili kartların tamamı — ama her kart ayrı ayrı denetim izine yazılır, toplam tutar ekranda. Bu ilke 5'i bozmaz, kolaylaştırır." **ÜM**: "Bunu doğrulamak lazım: toplu onay mevcut karar kutusunda var mı? Yoksa P1 UX işi." [Doğrulanmalı — kodda kontrol]

**BA** ikinci itirazını yaptı: "Müşteriye otomatik 'talebinizi aldık, 2 saat içinde dönüyoruz' mesajı atamıyor muyum? Herkes bunu yapıyor." **YZ** ve **BG** birlikte: "İlke 6: dışarıya giden her mesaj insan onaylı ve insanın adresinden. Otomatik alındı bildirimi bu ilkeyle doğrudan çelişir." → **ANA ÇATI ÇELİŞKİSİ (Ç-1)** olarak işaretlendi. Uyumlu alternatif: (a) proje oluştuğunda *sorumlu kişinin* telefonuna hazır 'alındı' taslağı tek dokunuşla onay; (b) müşteriye mesaj değil, talep kanalında (ör. web formu) ekranda statik "alındı" sayfası — bu dış *mesaj* değil. Ürün sahibine soru olarak gidiyor.

**Veri sahipliği ve çıkış**: **BA**: "Üç yıl veri girdim, sonra fiyat iki katına çıktı. Verimi alıp gidebilir miyim?" **ÜM**: "Evet, ve bunu sözleşmeye yazmalıyız: veri acentanındır." **EM**: "Tam dışa aktarım paketi: tüm tablolar JSON + CSV, üretilmiş belgeler PDF, ekler orijinal hâliyle, denetim izi dahil, şema dokümanıyla. İstediği an, self-servis." **BG**: "Ve şimdi zor kısım: acenta ayrıldıktan sonra verisini *silmemizi* isterse? Ya da KVKK gereği misafir verisi saklama süresi dolarsa? Bizim ilke 3: DELETE yok." → **ANA ÇATI ÇELİŞKİSİ (Ç-2)**. **BG**'nin uyumlu alternatifi: *kripto-imha* — kiracıya özel veri şifreleme anahtarı; ayrılışta (yasal saklama süreleri sonrası) anahtar imha edilir, satırlar fiziksel olarak durur ama okunamaz; kişisel alanlar zaten şifreli olduğundan anonimleştirme mevcut mekanizmayla yapılır; durum `offboarded`, audit_log'a "anahtar imhası" kaydı. Fiziksel silme gerekiyorsa yalnız yedek döngüsü ve ayrı, denetimli bir platform prosedürüyle — ama bu ilke 3 istisnası olduğu için ürün sahibi + avukat kararı. Ticari mevzuattaki defter/belge saklama yükümlülükleri ile KVKK imha yükümlülüğü arasındaki denge avukata [Doğrulanmalı].

**Destek erişimi**: **MD**: "Müşteri 'teklifim neden bloklandı' diye aradığında destek ekibim ekranı görmeli." **BG**: "RLS'i delen bir 'süper admin' asla. Kurgu: acenta yöneticisi destek erişimini *süreli* (ör. 2 saat) ve *kapsamlı* (salt okuma, PII maskeli) açar; destek kullanıcısı `mice_app` rolüyle, o kiracının `withTenant` bağlamında çalışır; her erişim denetim izine ve acentaya bildirime düşer." Bu ilke 2 ve 3 ile uyumlu bulundu.

**Kimlik**: **BG**: "Kurumsal DMC'ler SSO (Google Workspace / Entra ID) isteyecek; butik için passkey (WebAuthn zaten var) + şifre. Tüm kullanıcılar için MFA zorunlu, en azından yönetici ve finans rollerinde." **BA**: "Benim ekip şifreyi unutur." **BG**: "Passkey'de şifre yok. Telefonla giriş. Kolaylık ve güvenlik burada aynı yöne bakıyor."

**Entegrasyon yol haritası çatışması**: **ÜM** v0.5'e "Logo, Netsis, Paraşüt API + Gmail push + WhatsApp Embedded Signup + bedbank" koymak istedi. **EM** karşı çıktı: "Bunların her biri 4–10 haftalık iş ve çoğu dış onay bekler [Doğrulanmalı]. Üstelik canlı test edilmemiş üç entegrasyonumuz var. Kural önerim: *yeni entegrasyon yazmadan önce mevcutları canlıda doğrula.* v0.5: Gmail/Graph gönderim + gelen posta (watch/abonelik), WhatsApp tek numara canlı doğrulama, Embedded Signup başvurusu (paralel, takvim riski), muhasebe için *genel dışa aktarım çerçevesi* (eşleme tablosu kiracı kuralı olarak) + iki hazır profil (Mikro, Logo) [hangi iki — Doğrulanmalı, anketle]. e-Fatura entegratörlerinden otomatik çekme (pazardaki birkaç büyük özel entegratör) v0.6." **SA**: "OTA/bedbank fiyatına otomatik erişim hukuki olarak en riskli alan; kazıma (scraping) *yapılmamalı*. Bedbank/toptancı API'leri sözleşme ister ve genelde acentanın kendi hesabıyla açılır. Model: 'acentanın kendi API anahtarını bağla' — biz yalnız kanal fiyatı okuruz, rezervasyon yapmayız." **BG**: "Acentanın API anahtarı da sır; kiracı başına şifreli saklama, platformda görünmez."

**Çok para birimi**: **SA**: "Dubai'deki ya da Gürcistan'daki bir DMC, veya Türkiye'de USD ile çalışan bir acenta 'iç para birimim USD' diyecek." **FİM**: "İlke 7: iç para birimi EUR. Kiracı başına iç para birimi değiştirmek ana çatı değişikliği." → **ANA ÇATI ÇELİŞKİSİ (Ç-3)** eğer 'kiracı bazlı iç para birimi' istenirse. Uyumlu alternatif: iç hesap EUR kalır; *teklif para birimi*, *tedarikçi para birimi*, *raporlama görünüm para birimi* kiracı/proje bazlı seçilebilir; her dönüşüm kur kaydıyla (TCMB veya kiracının seçtiği kaynak) ve gerçekleşen kâr zaten tahsilat/ödeme günü kuruyla. **FİM**: "USD bazlı DMC için EUR iç hesap, kur farkı kârını/zararını ayrı satırda gösterdiği sürece kabul edilebilir; kabul etmeyen büyük müşteri çıkarsa ürün sahibine dönülür."

**Çok dil**: **ÜM**: "Arayüz TR + EN v0.5; müşteri belgeleri (teklif, program, sözleşme ekleri) TR/EN/DE/RU şablonlarıyla. AI zaten çok dilli okuyor (eval seti TR/EN/RU)." **MD**: "Belge şablonu çevirisi AI'ya bırakılmasın; şablon metinleri insan çevirisiyle sabit, yalnız değişken alanlar veriden. İlke 4 ile de uyumlu."

**White-label**: **SA**: "Büyük DMC kendi logosunu, kendi alan adını müşteri/tedarikçi linklerinde ister." **BG**: "Müşteri linkinde özel alan adı = sertifika yönetimi, kimlik avı (phishing) riski. Önce belge markalaması (logo, renk, alt bilgi) ve e-postanın zaten insanın adresinden gitmesi yeterli. Özel alan adı Kurumsal pakette, DNS doğrulamalı." **BA**: "Ben sizin logonuzu PDF'te görmek istemem." **ÜM**: "Hiçbir pakette görmeyeceksiniz; belgeler acentanın markasıyla çıkar." (Karar.)

**Mobil**: **MD**: "PWA'nın iOS'ta push için 'ana ekrana ekle' gerektirmesi [Doğrulanmalı — iOS sürüm şartları] onboarding'in en çok takıldığı adım olacak. Kurulum sihirbazında yöneticiye zorunlu adım." Native iOS uygulaması için docs/08 kriterleri korunur; SaaS'ta mağaza varlığı bir *güven sinyali* olarak tartışıldı, ama P3.

**Uptime/SLA**: **BG**: "Başlangıç taahhüdü aylık %99,5; planlı bakım hariç; RPO ≤ 15 dk, RTO ≤ 4 saat hedefi; şifreli yedek, yılda en az iki kez geri dönüş tatbikatı; herkese açık durum sayfası. %99,9 Kurumsal pakette, ancak çok bölgeli kurgu olmadan bunu yazmayın." **FİM**: "SLA ihlalinde hizmet kredisi; para iadesi değil."

**KVKK + yurt dışı aktarım**: **BG**: "Üç katman: (1) Veri barındırma: Türkiye'de mi, AB'de mi? Kamu kurumu ve bazı kurumsal müşteriler Türkiye'de barındırma isteyebilir [Doğrulanmalı]. (2) AI sağlayıcısı yurt dışında; misafir verisi gitmiyor, ama irtibat kişisi verisi maskelenerek bile gidebilir. 2024 KVKK değişikliğiyle yurt dışı aktarımda standart sözleşme ve bildirim gibi mekanizmalar geldi [Doğrulanmalı — avukat]. (3) Bizim rolümüz: acentaya karşı *veri işleyen*; acenta *veri sorumlusu*. Bunun için hazır VİS (veri işleme sözleşmesi), alt işleyen listesi, aydınlatma metni şablonu, VERBİS rehberi satış paketinin parçası olmalı." **SA**: "Bu belgeler satış çevriminde bir haftalık hukuk sorusunu bir güne indirir; kurumsal müşteride bu doğrudan hız."

**Pazaryeri/API**: **EM**: "Açık API'yi erken açarsak ilk müşteri bizi kendi yazdığı script'le karar kutusunu atlatmaya zorlar." **BG**: "API'den gelen her yazma işlemi aynı servis katmanından, aynı onay kapılarından geçmeli; API anahtarı bir *insan kullanıcıya* bağlı olmalı, AI aktörü gibi kapalı listeye tabi bir 'entegrasyon aktörü' rolü tanımlanmalı. Önce giden webhook'lar (proje durumu değişti, fatura onaylandı) ve salt okunur API." İlke 5 ve 6 ile uyumlu bulundu.

### Tur 5 — Rakamlar: fiyat, CAC/LTV, kurulum süresi

**FİM** taslak fiyat yapısını sundu (tümü **[Doğrulanmalı — pilot ve 10–15 acentayla fiyat görüşmesi]**, KDV hariç, EUR bazlı, TL'ye fatura günü kuruyla):

| Paket | Kime | İçerik | Taslak aralık |
|---|---|---|---|
| **Başlangıç** | Butik (≤5 iç kullanıcı) | Çekirdek 0–8 (sade mod), CRM-lite, muhasebe dışa aktarım, aylık AI kredisi, e-posta + WhatsApp, belge markalaması | ~150–300 EUR/ay |
| **Profesyonel** | Orta ölçek (6–20 kullanıcı) | + transfer modülü, bilet takip katmanı, çok dilli belgeler, gelişmiş raporlar, daha yüksek AI kredisi, öncelikli destek | ~450–900 EUR/ay |
| **Kurumsal / DMC / PCO** | 20+ kullanıcı, çok şirket | + SSO, özel alan adı, kongre kayıt köprüsü, API/webhook, %99,9 hedef SLA, ayrılmış onboarding yöneticisi, veri yerleşimi seçeneği | teklif usulü (~1.500 EUR/ay üstü) |

- **Saha kullanıcıları** (sezonluk, rehber/hostes/saha personeli): ücretsiz veya sembolik; aksi takdirde acenta saha ekibini sisteme almaz ve hedef 1 bozulur. Tedarikçi ve müşteri linkleri her zaman ücretsiz (giriş gerektirmez).
- **Kullanıcı mı proje mi?** **FİM** hibrit önerdi: paket = kullanıcı bandı + aktif proje bandı + AI kredisi. **BA**: "Ben sezonda 15 proje, kışın 2 proje yapıyorum. Kış boyunca neden aynı parayı ödeyeyim?" **FİM**: "Yıllık ödemede sezon esnekliği: yıllık proje havuzu. Aylık ödemede bant." **ÜM** itiraz etti: "Proje bazlı fiyat, acentayı küçük işleri sisteme *girmemeye* iter; kurum hafızası (hedef 7) delinir. Proje sayısını fiyat ölçütü yapmayalım; yalnız AI kredisini kullanımla ilişkilendirelim." Bu konuda **uzlaşma sağlanamadı** — bkz. Soru S-1.
- **Kurulum ücreti**: Başlangıç'ta self-servis + ücretsiz 2 canlı eğitim; veri taşıma hizmeti isteğe bağlı tek seferlik ücret (~birkaç yüz – birkaç bin EUR, veri hacmine göre) [Doğrulanmalı]. İlk 10 "tasarım ortağı" acentaya kurulum ücretsiz, 12 ay indirimli fiyat karşılığında referans + aylık geri bildirim.

**BA**: "Ayda 200 EUR, benim için ayda 8–10 bin TL civarı demek [Doğrulanmalı — güncel kur]. Bunu bana neyle ödetirsiniz?" **ÜM**: "Üç somut kalemle: (1) Teklif hızı — PRD hedefi 'talep → teklif ≤ 2 iş günü'; hızlı dönen acenta daha çok iş kazanır. (2) Kaçak — faturası kesilmemiş ekstra, tahsil edilmemiş fark, yanlış kurla hesaplanmış kâr. Yılda bir 120 kişilik projede tek bir unutulan transfer ekstrası aylık ücreti öder. (3) Personel bağımlılığı — operasyon uzmanı ayrıldığında yeni gelenin işi devralma süresi." **BA**: "Bunu bana kanıtlayabilir misiniz?" **MD**: "Evet: ilk 30 günde 'kaçak taraması' — son 6 ayın kapanmış 5 projesini birlikte sisteme alıp kapanış kontrolünden geçiriyoruz. Bulduğumuz farkı size rapor ediyoruz. Bulamazsak ilk ay ücretsiz." **FİM**: "Bu bir satış aracı ama dikkat: 'bulamazsak bedava' maliyetli. Tasarım ortaklarıyla deneyip sonra karar verelim." **BA** (ilk kez olumlu): "Bunu yaparsanız ortağıma anlatabilirim."

**CAC/LTV sezgisi** (**FİM**, tümü varsayım):
- Satış çevrimi butikte 2–6 hafta, kurumsalda 2–6 ay; satış saha ziyareti, demo, pilot gerektiriyor → CAC butikte ~1.000–3.000 EUR, kurumsalda ~5.000–15.000 EUR mertebesi [Doğrulanmalı].
- Aylık terk oranı başlangıçta %2–3 (butik), %1 altı (kurumsal) varsayımıyla; Başlangıç paketinde LTV ≈ ARPA × brüt marj ÷ terk → ~200 EUR × %75 ÷ %2,5 ≈ 6.000 EUR. LTV/CAC ~2–6. **Butik segment tek başına, düşük CAC'li kanal olmadan zayıf.**
- Sonuç: butik segment **kanal** (TÜRSAB bölge/üye etkinlikleri, sektör dernekleri, muhasebe bürosu ortaklıkları, referans) ve **self-servis onboarding** ile; orta/kurumsal segment **doğrudan satış** ile. Geri ödeme süresi hedefi < 12 ay.
- Brüt marjı tehdit eden kalemler: AI maliyeti (ölçülmeli), WhatsApp mesaj ücretleri (konuşma bazlı ücret Meta'dan, kiracıya yansıtılmalı [Doğrulanmalı]), SMS, destek saati.

**Kurulum süresi** (**MD**):
| Segment | Hedef | İçerik |
|---|---|---|
| Butik | **1. gün** ilk canlı talep; **1. hafta** ilk RFQ + teklif; **2–3 hafta** tam kullanım | Sihirbaz: acenta bilgisi, logo, kullanıcılar + passkey, e-posta bağlama, tedarikçi listesi (Excel), varsayılan kurallar onayı |
| Orta | 3–6 hafta | + 12–18 ay veri taşıma, rol/yetki, muhasebe eşleme |
| Kurumsal/DMC | 6–12 hafta | + SSO, çok şirket, entegrasyon, eğitim programı, kabul testi |

**MD** ekledi: "Aktivasyon metriği tanımlayalım: '14 gün içinde en az 1 müşteri teklifi sistemden gönderildi + yönetici karar kutusundan en az 1 karar verdi.' Bu ikisini yapmayan acenta 90 günde terk eder (sektör sezgisi)." **ÜM**: "Bu metrik ürün içinde ölçülmeli; sağlık skoru paneli platform tarafında — ama kiracı verisini okumadan, yalnız toplam sayaçlarla." **BG**: "Toplam sayaç bile kiracıya ait metaveri; VİS'e yazılmalı."

**BA**'nın "kaç günde öğrenirim" sorusuna **MD**: "Ortağınız yalnız telefondan karar kutusunu kullanacak: 'onayla / reddet / soru sor'. 15 dakikalık bir video ve bir görüşme. Operasyon uzmanınız 2 yarım günlük eğitim + ilk iki gerçek proje birlikte." **BA**: "İlk iki projeyi birlikte yaparsanız tamam."

### Tur 6 — Yakınsama: go-to-market ve v0.5 yol haritası

**SA** go-to-market'ı önerdi: "Aşama A (0–6 ay): pilot acenta + **8–12 tasarım ortağı**, karışık profil: 5–6 butik, 2–3 orta ölçek, 1–2 DMC/PCO. Aşama B (6–12 ay): sınırlı ticari açılış, Türkiye, TR+EN. Aşama C (12+ ay): bölgesel DMC'ler (Balkanlar, Kafkasya, Orta Doğu [Doğrulanmalı]) için çok dilli/çok para birimi görünümü ve veri yerleşimi." Konumlandırma cümlesi üzerinde uzlaşıldı: **"Etkinlik yazılımı değil; acentanın kâr ve hafıza sistemi. AI okur ve hazırlar, siz karar verirsiniz — AI'sız da çalışır."**

**Rekabet farkı** (uzlaşılan dört nokta): (1) tedarik–teklif–marj–tahsilat zincirinin tek veriden yönetimi ve 'eski belge gönderilemez' garantisi; (2) karar kutusu + kişi bazlı yetki + Face ID — 'kontrol kişide değil sistemde'; (3) Türkiye gerçekliği: e-Fatura UBL-TR okuma, TCMB kuru, konaklama vergisi, KVKK, Türk muhasebe programlarına aktarım; (4) dürüst AI: kaynak gösterimi, güven puanı, kapalı yetki listesi, otomasyon terfisinin ölçülebilir olması.

**ÜM** v0.5 kapsam önerisini okudu; **EM** ve **BG** kesintiler yaptı ("yeni entegrasyon değil, mevcutları canlıda doğrula"; "SaaS açılış güvenliği kapsamdan çıkmaz"). **YZ** "yazışma analizi kaynaklı cevap + soru takip listesi" maddesini P1'e çekti; **BA** "transfer hafif modülü"nü P1'e çekmek istedi, **ÜM** "P1 ama v0.5'in ikinci yarısı" dedi; **FİM** "faturalama/abonelik altyapısı olmadan tasarım ortaklarından para alamayız, ama ilk 6 ay elle faturalayabiliriz" dedi ve abonelik otomasyonu P2'ye indi — **MD** itiraz etti (elle faturalama 10 müşteriye kadar idare eder), not düşüldü.

**Açık kalan ayrışmalar** (ürün sahibine): fiyat ölçütü (kullanıcı vs proje vs hibrit), ilk hedef segment (butik ağırlıklı mı DMC ağırlıklı mı), barındırma yeri (TR vs AB), otomatik 'alındı' mesajı (Ç-1), çıkışta veri imhası (Ç-2), kiracı bazlı iç para birimi (Ç-3), sektör fiyat endeksi (Ç-4, aşağıda).

**Ç-4'ün doğuşu**: Kapanışa doğru **SA** şunu önerdi: "En büyük ağ etkisi fiyat verisinde. 200 acentanın otel teklifleri birleşirse 'bu otel bu sezon bu fiyata iyi mi' sorusuna sektör çapında cevap veririz — hedef 8 için bomba." **BG** derhal itiraz etti: "Bu, kiracı izolasyonunu (ilke 2) ve tedarikçiyle yapılan gizli fiyat anlaşmalarını ihlal eder; ayrıca rekabet hukuku açısından fiyat bilgisi paylaşımı riskli [Doğrulanmalı — rekabet hukukçusu]." **YZ**: "Ve 'rakip fiyatı pazarlıkta kullanılmaz' ürün kuralına ters." → **ANA ÇATI ÇELİŞKİSİ (Ç-4)**. Uyumlu alternatif: açık rıza ile (opt-in), kiracı veritabanının dışında, yalnız toplulaştırılmış ve k-anonim (ör. en az N acenta, en az M teklif) endeks; tekil tedarikçi fiyatı değil, bölge/yıldız/sezon bandı; pazarlık taslağında kullanılmaz, yalnız iç değerlendirmede "iyi/normal/bilmiyorum" sinyaline girdi. P3, hukuk görüşü şartlı.

Benzer şekilde **EM**'in "tedarikçi tek portal" fikri (bir otel, birçok acentanın RFQ'sunu tek yerde görsün) tartışıldı: ağ etkisi güçlü, ama tedarikçi kimliğinin kiracılar arası paylaşımı ilke 2'ye dokunuyor ve 'tedarikçiye müşteri adı gizli' kararıyla dikkatli tasarım istiyor. → **Ç-5**: uyumlu alternatif — tedarikçinin *kendine ait* ayrı bir hesap alanı (platform düzeyi, kiracı verisi içermeyen), kiracılardaki tedarikçi kayıtlarıyla yalnız tedarikçinin onayladığı bağlantı; RFQ verisi kiracıda kalır, tedarikçi her kiracı linkini ayrı token'la görür. P3.

Toplantı, aşağıdaki kararlar ve sorularla kapandı. **BA**'nın kapanış sözü: "Ben teknolojiye hâlâ şüpheyle bakıyorum. Ama 'AI'sız da çalışır', 'verin senin, istediğin an alırsın', 'ilk iki projeyi birlikte yapıyoruz' ve 'kaçak raporu' — bu dördünü sözleşmeye yazarsanız denerim. Fiyatı da tasarım ortağı olarak konuşuruz."

---

## 3) Kararlar

Öncelik: P1 (v0.5 için zorunlu) · P2 (v0.5 sonu / v0.6) · P3 (sonra). Efor: S (≤2 hafta) · M (2–6 hafta) · L (6+ hafta), tek küçük ekip varsayımıyla, kaba.

| # | Karar | Gerekçe | Hedef(ler) | Öncelik | Efor | v0.5? |
|---|---|---|---|---|---|---|
| K-1 | **Paketleme: çekirdek = 0–8 akışın tamamı** (sade mod + gelişmiş mod), ücretlendirme özellik kırparak değil ölçek + modülle. Çekirdekten adım çıkarılmaz. | Adım kırpmak "tek doğru kaynak"ı (ilke 4) ve kapanış kontrolünü bozar; en büyük değer kapanışta. | 1, 2, 6, 10 | P1 | M (sade mod arayüzü) | Evet |
| K-2 | **Yetki/abonelik `tenant_entitlements` tablosunda**, `rules` tablosunda değil; RLS'li, kiracı okur, yalnız platform süreci yazar, değişiklik audit'li. | Kurallar yöneticinin iş eşikleri (ilke 8); abonelik hakkı platformun. Eklemeli, ana çatıyla uyumlu. | 6 | P1 | S | Evet |
| K-3 | **Modül sırası:** (a) Transfer hafif modülü (araç planı, karşılama listesi, uçuş no/saat, şoför–araç ataması, saha checklist'i); (b) Bilet *takip* katmanı (PNR/bilet no, isim listesi, TKT time limit uyarısı + karar kartı, GDS/konsolidatör raporu içe aktarımı) — **bilet kesme yok**; (c) Kongre kayıt köprüsü (form → rooming, KVKK rızalı); (d) CRM-lite (pipeline görünümü mevcut veriden) çekirdekte; (e) tam CRM/pazarlama üst pakette. | Gerçek günlük acı transferde; GDS doğrudan entegrasyonu sözleşme/sertifikasyon yükü; kongre kaydı ayrı ürün dünyası. Domain detayı ilgili komitelere. | 1, 2, 3, 5 | (a) P1, (b) P1, (c) P2, (d) P1, (e) P3 | (a) M, (b) M, (c) M, (d) S–M, (e) L | (a)(b)(d) Evet; (c) v0.6 |
| K-4 | **"AI'sız da çalışır" garantisi**: AI sağlayıcısı kapalı/kredi bitmiş/kesinti durumunda tüm akış, onay, belge, hesap çalışır; ayıklama elle yapılır. Arayüzde "AI devre dışı" modu ve durum göstergesi. | Sektörün AI güvensizliğine en güçlü cevap; kredi aşımında sistem durmaz. Deterministik mock zaten var. | 2, 6 | P1 | S–M | Evet |
| K-5 | **AI kullanım ölçümü**: kiracı × işlem türü × model × token × tahmini maliyet; paket bazlı aylık AI kredisi + adil kullanım; aşımda AI düşük öncelikli/elle moda iner, sistem durmaz. Pilotta proje başı gerçek maliyet raporlanır. | Ölçülmeden fiyatlanamaz; uç kullanıcı riski (büyük kongre). | 10 | P1 | M | Evet |
| K-6 | **Kaynaklı cevap zorunluluğu (yazışma analizi)**: "Bu projeye sor" ve yazışma analizinde her iddia bir kaynağa (e-posta, madde, revizyon) bağlı; kaynak yoksa "bilmiyorum"; çelişki gösterilir. **Soru takip listesi**: müşterinin yazışmada sorduğu her soru → cevaplandı / cevaplanmadı / çelişkili. Cevap taslağı yine insan onaylı ve insanın adresinden. | Hedef 9'un dürüst ürünü; halüsinasyonu doğrulanabilir kılar. İlke 6 ile uyumlu. | 3, 5, 9 | P1 | M–L | Evet |
| K-7 | **Gerçek doğruluk ölçümü**: pilot düzeltmelerinden maskeli gerçek set (alan türü bazlı), Claude ile ölçüm, alan türü bazlı eşiklerin `rules`'a yazılması (yönetici değiştirir), CI'da gerileme kapısı. Satış materyalinde ölçülmemiş doğruluk rakamı **yasak**. | Güven puanı kalibre değilse "güven" satılamaz. | 2, 9 | P1 | M | Evet |
| K-8 | **PDF/görsel PII maskeleme**: belge modele gitmeden önce metin çıkarımı + maskeleme; görsel gönderimi kiracı kuralıyla (varsayılan temkinli). AI sağlayıcı veri saklama/eğitim koşullarının sözleşmeyle teyidi [Doğrulanmalı]. | Durum tablosu: PDF/görsel maskelenmiyor; SaaS'ta her acentanın riski. | KVKK (ilke 9) | P1 | M | Evet |
| K-9 | **Sesli not**: tarayıcı Web Speech varsayılan **kapalı** (açılırsa üçüncü taraf uyarısı); sunucu tarafı STT, veri yerleşimine uygun sağlayıcıyla. Sesli asistan yalnız okuma/taslak; sesle onay **asla**. | Ses kaydı kontrol dışı yurt dışına çıkabilir [Doğrulanmalı]. | 3, KVKK | STT P2, varsayılan-kapalı P1 | S / M | Varsayılan kapalı: Evet; sunucu STT: v0.5 sonu |
| K-10 | **SaaS açılış güvenliği paketi**: kiracı provizyonu (platform süreci, `apply_standard_policies` kalıbıyla), tüm yönetici/finans rollerinde MFA (passkey öncelikli), yenileme belirteci (HttpOnly), nesne deposu (kiracı önekli, şifreli), kurumsal için SSO (Google/Entra) P2, sızma testi (bağımsız) canlıdan önce, ISO 27001 yol haritası. | Tablo: SSO, yenileme belirteci, nesne deposu ⛔. | 6, 7 | P1 (SSO P2) | L | Evet |
| K-11 | **Süreli, onaylı destek erişimi**: acenta yöneticisi açar (süre + kapsam: salt okuma, PII maskeli); destek `mice_app` + `withTenant` içinde; her erişim audit + acentaya bildirim. RLS'i aşan süper admin **yok**. | Destek ihtiyacı ile ilke 2/3 uyumu. | 5, 6 | P1 | M | Evet |
| K-12 | **Veri sahipliği ve dışa aktarım**: sözleşmede "veri acentanındır"; self-servis tam dışa aktarım (JSON + CSV + PDF belgeler + orijinal ekler + audit_log + şema dokümanı); ayrılışta 90 gün salt okuma + dışa aktarım penceresi [süre Ürün kararı]. İmha → Ç-2 (soru). | Güven ve satış itirazının bir numarası; hedef 7 kurum hafızasını acentaya garanti eder. | 7 | P1 | M | Evet |
| K-13 | **KVKK satış paketi**: VİS (veri işleme sözleşmesi) şablonu, alt işleyen listesi (barındırma, AI, e-posta, WhatsApp, SMS), yurt dışı aktarım mekanizması [Doğrulanmalı — avukat], aydınlatma/rıza metin şablonları, VERBİS rehberi, DPIA özeti. | Kurumsal satış çevrimini kısaltır; ilke 9. | 5, KVKK | P1 | M (hukuk ağırlıklı) | Evet |
| K-14 | **Mevcut entegrasyonları canlıda doğrula, sonra yenisini yaz**: Gmail/Graph gönderim + gelen posta (watch/abonelik), Google OAuth doğrulama/güvenlik değerlendirmesi başvurusu [Doğrulanmalı], WhatsApp tek numara canlı + Embedded Signup/teknoloji sağlayıcı başvurusu [Doğrulanmalı], SMS sağlayıcısı seçimi. Başvurular takvim riski olduğu için **hemen** başlatılır. | "Uygulandı, canlı test edilmedi" satırları SaaS'ın kritik yolu. | 3, 5 | P1 | M (+ dış bekleme) | Evet |
| K-15 | **Muhasebe dışa aktarım çerçevesi**: eşleme profili kiracı ayarı; hazır profiller Mikro (sütunlar doğrulanarak) + bir ikinci program [Logo / Paraşüt / Luca — müşteri anketiyle seçilecek, Doğrulanmalı]; ay sonu "muhasebeci paketi" (CSV/XLSX + e-Fatura XML'leri + ödeme listesi). API entegrasyonları v0.6+. | Butik acentanın muhasebecisi yazılım değiştirmez. | 10 | P1 | M | Evet |
| K-16 | **Kanal/bedbank fiyatı**: kazıma (scraping) yapılmaz; "acentanın kendi API hesabını bağla" modeli, yalnız fiyat okuma, rezervasyon yok; anahtarlar kiracı başına şifreli. | Hukuki risk (PRD §14); hedef 8. | 8 | P2 | L (sağlayıcı başına M) | Hayır (v0.6) |
| K-17 | **Çok dil / çok para birimi (ana çatıyla uyumlu)**: arayüz TR + EN; müşteri belgeleri TR/EN/DE/RU şablonları (insan çevirisi, değişken alanlar veriden); iç hesap **EUR kalır**; teklif, tedarikçi ve raporlama *görünüm* para birimi kiracı/proje bazlı, her dönüşüm kur kaydıyla, kur farkı ayrı satır. | Uluslararası DMC ihtiyacı; ilke 7 korunur. | 3, 10 | TR+EN arayüz P1, belge dilleri P1, görünüm para birimi P2 | M / M / M | Kısmen (dil: evet; görünüm para birimi v0.6) |
| K-18 | **White-label kademeli**: tüm paketlerde belgeler yalnız acenta markasıyla (bizim logomuz yok); müşteri/tedarikçi link sayfası markalaması P2; özel alan adı Kurumsal'da, DNS doğrulamalı, P3. | Kimlik avı riski; değer/maliyet. | 5 | P2/P3 | S / M | Belge markalaması evet |
| K-19 | **Mobil**: PWA devam; kurulum sihirbazında yönetici için "ana ekrana ekle + bildirim + passkey" zorunlu adımı; toplu onay (tek Face ID ile seçili kartlar, her kart ayrı audit, toplam ekranda) [mevcutta var mı Doğrulanmalı]. Native iOS docs/08 kriterlerine bağlı, P3. | iOS push şartları onboarding darboğazı [Doğrulanmalı]; sezonda onay yükü. İlke 5 korunur. | 1, 3, 6 | P1 | S–M | Evet |
| K-20 | **SLA**: aylık %99,5 (Başlangıç/Pro), RPO ≤ 15 dk, RTO ≤ 4 sa hedefi, şifreli yedek + yılda ≥2 geri dönüş tatbikatı, herkese açık durum sayfası, ihlalde hizmet kredisi; %99,9 yalnız çok bölgeli kurgu sonrası Kurumsal'da. | Güvenilir irtibat ve kurumsal satış şartı. | 5 | P1 | M | Evet |
| K-21 | **API / pazaryeri kademeli**: önce giden webhook'lar + salt okunur API (P2); yazma API'si aynı servis katmanı ve onay kapılarından, insan kullanıcıya bağlı anahtarla, kapalı yetki listeli "entegrasyon aktörü" rolüyle (P3); pazaryeri P3. | Karar kutusunu atlatma riski (ilke 5, 6). | 6 | P2/P3 | M / L | Hayır |
| K-22 | **Onboarding modeli**: "1. gün ilk canlı talep, 1. hafta ilk teklif" hedefli sihirbaz; veri taşıma isteğe bağlı ve *sonradan* (değer önce, taşıma sonra); ilk iki gerçek proje birlikte; **30 gün kaçak taraması** (5 kapanmış projeyi kapanış kontrolünden geçirip fark raporu) tasarım ortaklarıyla denenir; aktivasyon metriği: 14 günde ≥1 gönderilmiş teklif + ≥1 karar kutusu kararı; platform sağlık skoru yalnız toplam sayaçlarla (VİS'te tanımlı). | Butik müşteriyi ilk haftada kaybetmemek. | 1, 7, 10 | P1 | M | Evet |
| K-23 | **Fiyat listesi EUR bazlı, TL'ye fatura günü kuruyla**; saha kullanıcıları ücretsiz/sembolik; müşteri/tedarikçi linkleri her zaman ücretsiz; yıllık peşinde indirim + sezon esnekliği; ilk 8–12 tasarım ortağına ücretsiz kurulum + 12 ay indirim karşılığı referans/geri bildirim. Tutarlar [Doğrulanmalı]. Ölçüt seçimi → S-1. | Enflasyon/kur; saha ekibi sisteme girmezse hedef 1 bozulur. | 1, 10 | P1 (politika) | S | Evet (politika olarak) |
| K-24 | **Abonelik/faturalama otomasyonu** (plan, deneme, TR ödeme sağlayıcısı [iyzico/PayTR/Stripe vb. — Doğrulanmalı], kendi e-Faturamız): ilk ~10 müşteriye kadar elle faturalama kabul; otomasyon v0.6. | Tasarım ortağı aşamasında öncelik ürün değeri. (MD şerhi: 10 müşteriden sonra zorunlu.) | — | P2 | M–L | Hayır |
| K-25 | **Go-to-market**: Aşama A (0–6 ay) pilot + 8–12 karışık profilli tasarım ortağı; Aşama B (6–12 ay) Türkiye ticari açılış TR+EN; Aşama C (12+ ay) bölgesel DMC'ler. Butik → kanal (TÜRSAB/sektör dernekleri/muhasebe bürosu ortaklığı/referans) + self-servis; orta/kurumsal → doğrudan satış. Konumlandırma: "Etkinlik yazılımı değil; acentanın kâr ve hafıza sistemi. AI okur ve hazırlar, siz karar verirsiniz — AI'sız da çalışır." | Küçük, değer odaklı pazar; LTV/CAC butikte ancak düşük CAC'li kanalla tutar. | Tümü | P1 | — | Evet (strateji) |
| K-26 | **Audit hash zinciri** (değiştirilemezlik kanıtı) ve audit bölümleme | Kurumsal satışta "kayıtlar sonradan değiştirilemez" iddiasının kanıtı; ilke 3'ü güçlendirir. | 6, 7 | P2 | M | v0.5 sonu |
| K-27 | **Rakip ve pazar doğrulama çalışması**: TÜRSAB/derneklerden MICE yapan acenta sayısı, yerli rakip taraması, 10–15 acentayla fiyat görüşmesi, muhasebe programı dağılımı anketi. | Rakamların çoğu [Doğrulanmalı]. | — | P1 | S (ürün/iş geliştirme) | Evet (paralel) |

---

## 4) Ürün sahibine sorular

**S-1 — Fiyat ölçütü ne olsun?**
- (a) Kullanıcı bazlı (iç kullanıcı başı; saha ücretsiz)
- (b) Proje bazlı (aktif/kapanan proje başı)
- (c) Hibrit: paket = kullanıcı bandı + AI kredisi; proje sayısı ölçüt **değil**
- (d) Hibrit: kullanıcı bandı + aktif proje bandı + AI kredisi (FİM önerisi)
- **Öneri: (c).** Proje bazlı ölçüt acentayı küçük işleri sisteme girmemeye iter, kurum hafızasını (hedef 7) deler. Sezon esnekliği yıllık ödemede indirimle verilir. Komite bu konuda bölündü: FİM (d), ÜM ve MD (c), BA "proje başı adil ama kışın ödeme olmasın" (b'ye yakın).

**S-2 — İlk hedef segment?**
- (a) Butik ağırlıklı (çok sayıda, düşük ARPA, kanal gerekir)
- (b) Orta ölçek + DMC/PCO ağırlıklı (az sayıda, yüksek ARPA, uzun satış)
- (c) Karışık tasarım ortağı grubu, ticari açılışta orta ölçek öncelikli
- **Öneri: (c).** Ürün butiğe sade modla uyuyor ama birim ekonomisi orta ölçekte daha sağlam.

**S-3 — Barındırma yeri?**
- (a) Türkiye'de veri merkezi/bulut bölgesi
- (b) AB bölgesi
- (c) Varsayılan AB, Kurumsal pakette Türkiye seçeneği
- **Öneri: (c)**, avukat görüşüyle [Doğrulanmalı]. AI çağrıları her durumda yurt dışına gider; yurt dışı aktarım mekanizması her senaryoda gerekir.

**S-4 — Ç-1: Müşteriye otomatik "talebiniz alındı" mesajı?** (bkz. §5)
- (a) Hayır, ilke 6 aynen: sorumluya tek dokunuşla onaylanacak hazır taslak
- (b) İlke 6'ya dar istisna: insan tarafından bir kez onaylanmış, değişken içermeyen sabit şablon, yalnız "alındı" türü, kiracı kuralıyla açılır, varsayılan kapalı
- **Öneri: (a)**; (b) seçilirse ana çatı değişikliği olarak CLAUDE.md ve `ai-authority.ts` güncellenmeli.

**S-5 — Ç-2: Acenta ayrılınca veya saklama süresi dolunca veri imhası?**
- (a) Kripto-imha (kiracı anahtarının imhası) + anonimleştirme; satırlar fiziksel olarak durur, DELETE yok
- (b) Yasal saklama sonrası fiziksel silme (ilke 3'e denetimli platform istisnası)
- **Öneri: (a)**, avukat teyidiyle [Doğrulanmalı]. Ayrılışta salt okuma + dışa aktarım penceresi süresi (öneri 90 gün) de karar bekliyor.

**S-6 — Ç-3: Kiracı bazlı iç para birimi (ör. USD bazlı DMC)?**
- (a) Hayır; iç hesap EUR, görünüm/teklif/raporlama para birimi seçilebilir (K-17)
- (b) Evet; kiracı başına iç para birimi (ilke 7 değişir)
- **Öneri: (a).** (b) yalnız büyük bir müşteri bunu şart koşarsa yeniden açılsın.

**S-7 — Ç-4: Sektör fiyat endeksi (kiracılar arası toplulaştırılmış fiyat verisi)?**
- (a) Hiç yapılmaz
- (b) P3: açık rızalı, kiracı DB'si dışında, k-anonim, bant bazlı, pazarlıkta kullanılmaz, rekabet hukuku görüşü şartlı
- **Öneri: (b)**, ama v0.5'te yalnız hukuk görüşü alınsın.

**S-8 — Ç-5: Tedarikçi için platform düzeyinde tek hesap/portal?**
- (a) Hayır, her kiracı linki bağımsız kalır (bugünkü yapı)
- (b) P3: tedarikçinin kendi alanı, kiracı verisi içermez, kiracılarla yalnız tedarikçi onaylı bağlantı
- **Öneri: (a)** şimdilik; (b) ağ etkisi için Aşama C'de değerlendirilsin.

**S-9 — Bilet modülünün sınırı?**
- (a) Takip katmanı + içe aktarım (bilet kesme yok) — K-3(b)
- (b) GDS/NDC ile doğrudan bilet kesme
- **Öneri: (a).** (b) için en az bir GDS ile ticari görüşme ve IATA yetkili acenta talebinin ölçülmesi gerekir [Doğrulanmalı].

**S-10 — "Kaçak taraması — bulamazsak ilk ay ücretsiz" satış garantisi?**
- (a) Evet, herkese
- (b) Yalnız tasarım ortaklarıyla dene, sonra karar
- (c) Hayır
- **Öneri: (b).**

---

## 5) Ana çatı çelişkileri

| Kod | Öneri | Çelişen ilke | Uyumlu alternatif (komite önerisi) | Durum |
|---|---|---|---|---|
| **Ç-1** | Müşteriye otomatik "talebiniz alındı" mesajı (BA) | **6** — dış mesaj insan onaylı ve insanın adresinden | Sorumlu kişiye tek dokunuşla onaylanacak hazır taslak; ya da talep web formunda ekranda statik "alındı" sayfası (mesaj değil) | Ürün sahibine soruldu (S-4); öneri ilkeyi korumak |
| **Ç-2** | Acenta ayrılışı / saklama süresi sonu fiziksel silme (BG'nin işaret ettiği KVKK ihtiyacı) | **3** — silinmez kayıt, DELETE yok | Kiracıya özel anahtarla kripto-imha + mevcut anonimleştirme; `offboarded` durumu; audit'e imha kaydı | Ürün sahibi + avukat (S-5) |
| **Ç-3** | Kiracı bazlı iç para birimi (USD bazlı DMC) (SA) | **7** — iç para birimi EUR | İç hesap EUR; teklif/tedarikçi/raporlama görünüm para birimi seçilebilir, kur kayıtlı, kur farkı ayrı satır (K-17) | Ürün sahibine soruldu (S-6) |
| **Ç-4** | Kiracılar arası sektör fiyat endeksi (SA) | **2** — çok kiracılı izolasyon (ve "rakip fiyatı pazarlıkta yasak" kuralı) | Opt-in, kiracı DB dışı, k-anonim, bant bazlı toplulaştırma; pazarlık taslağında kullanılmaz; hukuk görüşü şartlı | P3, S-7 |
| **Ç-5** | Platform düzeyinde tek tedarikçi portalı (EM) | **2** — kiracı izolasyonu (ve "tedarikçiye müşteri adı gizli" kararı) | Tedarikçinin kiracı verisi içermeyen kendi alanı; kiracı kayıtlarıyla yalnız tedarikçi onaylı bağlantı; RFQ verisi kiracıda | P3, S-8 |
| — | (Kontrol edilip **çelişmediği** bulunanlar) Abonelik yetkisi `tenant_entitlements`'ta (K-2, ilke 8'i korur); destek erişimi `withTenant` içinde (K-11); toplu Face ID onayı her kart ayrı audit'le (K-19, ilke 5); yazışma analizi cevapları insan onaylı (K-6, ilke 6); API yazma işlemleri onay kapılarından (K-21, ilke 5/6); belge dilleri şablondan, veriden (K-17, ilke 4); sesle onay yok (K-9, ilke 5) | — | — | Uyumlu |

---

## 6) Diğer komitelere sorular / bağımlılıklar

- **Operasyon / transfer komitesine:** Transfer hafif modülünün minimum alan seti (K-3a) — uçuş takibi elle mi, API mi; saha checklist'inin rooming list ile ilişkisi; şoför/araç tedarikçi mi, ayrı kaynak mı? Uçuş takip API'si sağlayıcısı [Doğrulanmalı].
- **Bilet / ulaşım komitesine:** Takip katmanında zorunlu alanlar (PNR, isim listesi son tarihi, TKT time limit, ücret kuralı özeti, iade/değişiklik durumu); GDS/konsolidatör rapor formatları; IATA yetkili acenta oranı [Doğrulanmalı] — S-9 cevabı buna bağlı.
- **Kongre / PCO komitesine:** Kayıt köprüsü mü, tam kayıt modülü mü? Hangi kayıt platformlarıyla entegrasyon önceliği? Binlerce katılımcı PII'si için DPIA.
- **Finans / muhasebe komitesine:** Mikro sütunlarının gerçek doğrulaması; ikinci muhasebe profili seçimi (K-15); e-Fatura entegratörlerinden otomatik çekme önceliği; AI kredi aşım ücretinin muhasebe kaydı; SaaS'ın kendi e-Fatura yükümlülüğü (K-24).
- **Hukuk / KVKK komitesine:** Yurt dışı aktarım mekanizması (AI sağlayıcı, e-posta, WhatsApp, barındırma) [Doğrulanmalı]; kripto-imha'nın KVKK imha yükümlülüğünü karşılayıp karşılamadığı ve ticari defter saklama süreleriyle ilişkisi (Ç-2); VİS ve alt işleyen listesi şablonu (K-13); sektör fiyat endeksi için rekabet hukuku görüşü (Ç-4); tasarım ortağı sözleşmesi (indirim + referans + veri sahipliği maddeleri).
- **Tedarikçi ilişkileri komitesine:** Tedarikçi tek portal fikrinin (Ç-5) tedarikçi tarafındaki karşılığı; bedbank/toptancı API'lerinde acentanın kendi hesabını bağlama modeli (K-16) tedarikçi sözleşmeleriyle uyumlu mu?
- **Satış / müşteri iletişimi komitesine:** Ç-1 (otomatik alındı mesajı) için hız hedefini (hedef 3) ilke 6'yı bozmadan karşılayan alternatiflerin yeterliliği; yazışma analizi soru takip listesinin (K-6) iş akışındaki yeri; CRM-lite alanları.
- **Tüm komitelere:** Önerdikleri her yeni modül için (i) AI'sız çalışma yolu (K-4), (ii) AI maliyeti tahmini (K-5), (iii) sade mod karşılığı (K-1), (iv) paket yerleşimi (K-2/K-23) belirtilsin.
