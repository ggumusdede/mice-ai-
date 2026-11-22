# Komite B — TEDARİK (satın alma ve tedarikçi ilişkileri)

> Kapsam: PRD v0.4 ve BRIEF.md'deki mevcut durum; ürün sahibinin 10 hedefi (özellikle 4 tedarikçi ilişkisi, 8 fiyat değişkenliği,
> 2 hata, 10 kârlılık). Sektör geneli bakış: butik acenta, büyük DMC, kongre organizatörü (PCO).
> Kişiler kurgusaldır; anekdotlar sektörde sık yaşanan durumların temsilidir. `[Doğrulanmalı]` = hukuki/tedarikçi teyidi gerekir,
> `[Ürün kararı]` = ürün sahibinin seçimi gerekir.

---

## 1) Katılımcılar

| Rol | Kişi (kurgusal) | Arka plan | Öncelik / önyargı |
|---|---|---|---|
| Satın Alma Direktörü | **Serap Aydın** | 22 yıl; büyük bir İstanbul DMC'sinde yıllık ~38 M EUR satın alma hacmi, 400+ aktif tedarikçi | Fiyat disiplini, kontrat, hacim taahhüdü; "veri yoksa pazarlık yok" |
| Otel İlişkileri Direktörü | **Kerem Özbek** | 17 yıl; zincir otel satıştan acentaya geçti; allotment ve grup blokesi uzmanı | İlişki ve sözünü tutmak; "otel seni hatırlar" |
| Uçak Bilet Kesme Uzmanı | **Levent Kaya** | 19 yıl; Amadeus/Sabre, IATA BSP, THY ve Pegasus grup masaları, NDC geçişi | Time limit, isim listesi, ADM korkusu; "biletin hatası geri alınmaz" |
| Havalimanı Transfer Uzmanı | **Murat Demirci** | 15 yıl; IST/SAW/AYT/ADB'de günde 120 araca kadar operasyon yönetti | Uçuş takibi, şoför disiplini, 03:00 gerçekliği |
| Etkinlik Teknik/AV ve Mekân Uzmanı | **Elif Taşkın** | 14 yıl; kongre merkezi, otel balo salonu, açık hava; teknik rider yazımı | Rider versiyonu, kurulum/söküm saatleri, gizli mekân ücretleri |
| Vize ve Seyahat Sigortası Uzmanı | **Nazlı Er** | 12 yıl; Schengen/İngiltere/ABD grup vizeleri, davet mektubu, grup poliçeleri | Takvim ve belge; pasaport verisinin hassasiyeti |
| DIŞ SES — Tedarikçi | **Hande Yılmaz** | İstanbul'da 600 odalı 5* otelin Grup & MICE Satış Müdürü; haftada ~70 grup RFQ'su alıyor | Tedarikçinin gözünden: zaman, adalet, ödeme, saygı |
| Moderatör / yazman | Panel sekreteryası | — | Ana çatı kontrolü, karar kaydı |

---

## 2) Tartışma tutanağı

### Tur 1 — Her üye ürünü kendi rolünden değerlendiriyor

**Serap (Satın Alma):** "Sistemin en güçlü tarafı, RFQ'nun sorumlu kişinin kendi adresinden gitmesi ve gelen her yanıtın kalem kalem
fiyat geçmişine yazılması. Bugün bizde o veri, ayrılan satın almacının Outlook'unda ölüyor — hedef 7'nin tam karşılığı. Ama bir
eksik var ki diğer her şeyi gölgeliyor: **yıllık anlaşmalı fiyat yok.** Biz İstanbul'da 40 otelle sezonluk kontrat yapıyoruz. Bir talep
geldiğinde ilk soru 'kontratımız var mı?' olmalı, 'RFQ atalım' değil. Kontrat fiyatı yoksa sistem her seferinde piyasayı sıfırdan
soruyor; bu, hedef 8'in (fiyat değişkenliğini azaltmak) tam tersi. Ayrıca 'iyi/normal/bilmiyorum' sınıflaması fiyat geçmişinin
medyanına dayanıyor — o medyan 18 aylık TL enflasyonu, sezon farkı ve kapsam farkıyla kirli. Yanlış güven verir."

**Kerem (Otel İlişkileri):** "Benim dünyam allotment, release ve attrition. Sistemde bunların hiçbiri yok, sadece 'opsiyon süresi'
var. Gerçekte bir kongre için 18 ay önceden 250 odalık blok alırsın; 90, 60, 30, 21 gün release kademeleri vardır; cut-off'ta
alınmayan oda otele döner; attrition maddesi genelde %10–20 toleranstır, fazlası ödenir. Bunları biri Excel'de tutar, o kişi izne
çıkınca release kaçar, otel 40 oda için fatura keser. Bir de **opsiyon sırası** var: otel sana '2. opsiyon' verdiyse, 1. opsiyon
sahibi bırakmadıkça odan yok. Sistem '2. opsiyonu' gerçek opsiyon gibi gösterirse müşteriye yanlış söz verilir."

**Levent (Bilet):** "Uçak bileti modülü yok, biliyorum; ama genel 'bilet' kalemi bugün tehlikeli bile. Bilet, otelden farklı:
**time limit** geçerse PNR düşer, grup fiyatı kaybolur, aynı fiyatı tekrar bulamazsın. THY'de 10+ yolcu grup talebi açılır, depozito
istenir, isim listesi için bir son tarih verilir — sözleşmeye göre değişir ama çoğu zaman kalkıştan birkaç hafta önce
[Doğrulanmalı: havayolu bazında]. İsim değişikliği ücretlidir veya yasaktır; ücret kuralını okumadan 'iade edilir' diyen satışçı
acentaya ADM (Agency Debit Memo) yedirir. Benim ilk isteğim GDS entegrasyonu değil: **her uçuş kalemi için PNR, ücret kuralı özeti,
TKT time limit ve isim listesi son tarihi alanları, bunların karar kutusuna kart düşürmesi.** Ve net bir şey: AI bilet kesemez;
zaten yasak listesinde 'konfirmasyon' var, iyi."

**Murat (Transfer):** "Transfer 'kişi/gün' normalizasyonuna sığmaz; araç × sefer × bekleme mantığıdır. 180 kişilik grubun 11 farklı
uçuşla geldiği bir kongrede ihtiyaç: uçuş manifesti → araç planı (otobüs 46, midibüs 27, VIP Vito 6) → karşılama listesi → şoför
ataması → canlı uçuş takibi. Rötarda bekleme ücreti başlar; dış hatlarda genelde 60 dk, iç hatlarda 30 dk ücretsiz bekleme, sonrası
saat ücreti — ama bu firmadan firmaya değişir, kural tablosunda olmalı. En büyük korkum: sistem 'dışarıya giden her mesaj insan onaylı'
diyor. Gece 02:40'ta Frankfurt uçağı 95 dk rötar yaptı; o şoföre birinin haber vermesi lazım. Onay bekleyen kart sabah 08:00'de
görülürse 3 saatlik bekleme parası öderiz."

**Elif (AV/Mekân):** "Teklif normalizasyonu 'kişi başı / gün başı' AV için anlamsız. AV paket/gün, kurulum günü, prova, söküm ve
overtime ile fiyatlanır. Asıl tuzak **gizli mekân maliyetleri**: in-house AV zorunluluğu, harici AV firmasına 'giriş/bağlantı ücreti',
elektrik bağlantısı (kVA başına), yük asansörü saati, kurulum gecesi salon kirası, rigging noktası ücreti. PRD'de gizli maliyet olarak
'garanti, attrition, ödeme, iptal, overtime' sayılmış — AV'ninkiler eksik. İkinci ihtiyaç **teknik rider**: sahne ölçüsü, LED duvar
çözünürlüğü, tercüme kabini sayısı, mikrofon listesi. Bu bir belge ve veriden üretilmeli; konuşmacı sayısı değişince rider 'eski'
olmalı. Sizin 4 numaralı ilkenize birebir oturuyor."

**Nazlı (Vize/Sigorta):** "Vize ve sigorta tedarikçi değil gibi görünür ama takvimin en kırılgan halkasıdır. Schengen randevusu yoğun
dönemde haftalarca sonraya verilir; davet mektubu, otel konfirmasyonu, sigorta poliçesi dosyaya girmezse başvuru eksik sayılır.
Bir teşvik gezisinde 64 kişiden 3'ü ret alırsa: uçak bileti iade kuralı, otel iptal koşulu, transfer araç sayısı değişir. Bu zincir
bugün kimsenin ekranında birleşmiyor. Ama kırmızı çizgim: **pasaport verisi.** Pasaport fotokopisini AI'ye 'okut' diyeceklerdir;
sizin 9. ilkeniz misafir verisini modele göndermiyor — doğru, bunu esnetmeyin. Ayrıca acentanın sigorta 'satması' sigorta aracılığı
mevzuatına girebilir [Doğrulanmalı]; sistem 'poliçe takibi' yapsın, 'poliçe satışı' değil."

**Hande (Otel — dış ses):** "Size dürüst olayım. Haftada 70 RFQ alıyorum; yarısı 'fiyat avı'. Giriş gerektirmeyen link benim için
iyi — beşinci portal şifresini istemiyorum. Ama üç şeyden çekinirim. Bir: 3–5 otele paralel RFQ attığınızı bilirim; 24 saatte
otomatik hatırlatma 'yarışa sokuldum' hissi verir. İki: AI'nin yazdığı pazarlık maili belli olur, kalıp cümleler... Üç tur otomatik
pazarlık ilişkiyi soğutur. Üç: fiyatımı OTA ile kıyaslamanız. Grup fiyatı, BAR'dan farklı koşullarla gelir: garanti, depozito,
ücretsiz oda politikası (genelde 20+1 veya 25+1), toplantı paketi. 'Web'de daha ucuz' derseniz, 'o zaman web'den alın' derim.
Bir de şunu sorayım: siz beni puanlıyorsunuz; ben de acentaları puanlıyorum. Release'e uymayan, opsiyonu son gün bırakan, ödemeyi
45 gün geciktiren acentaya bir dahaki sefere blok vermem. Sizin sistem acentanın **tedarikçiye karşı** sözünü tutmasını ölçüyor mu?"

**Moderatör özeti (Tur 1):** Ortak eksikler: kontrat fiyatı, allotment/release/attrition, opsiyon sırası, uçuş kalemi alanları ve
time limit'ler, transfer operasyonu, AV gizli maliyetleri ve rider, vize/sigorta takvimi. Ortak risk: "iyi fiyat" yanılgısı ve
tedarikçinin "makineyle muhatap" hissi. Yeni fikir: acentanın tedarikçiye karşı güvenilirliğini ölçmek (Hande).

---

### Tur 2 — Opsiyon çakışması, allotment ve kur

**Kerem:** "Somut vaka: Otel 14 gün 1. opsiyon verdi. Müşterinin satın alma birimi 21 gün istiyor. Sistem 'müşteri opsiyonu
tedarikçininkinden uzun olamaz' kuralıyla teklifi 14 günle sınırlar — doğru. Ama günlük hayatta ne yaparız? Gün 10'da oteli arayıp
uzatma isteriz. Sistemde 'opsiyon uzatma talebi' akışı yok. Uzatma gelince müşteri teklifinin opsiyonu da güncellenmeli, ve bu bir
belge değişikliği — teklif 'eski' olmalı."

**Hande:** "Uzatma isteyin, sorun değil; sorun, son gün sessizce düşürmek. Biz 2. opsiyon sahibine 'oda açıldı' diyemiyoruz çünkü
acenta cevap vermiyor. Opsiyonu bırakacaksanız 1 gün önce söyleyin — bir satır mail."

**Serap:** "Bunu kural yapalım: opsiyon bitimine T-3 gün kala karar kartı: 'Uzat / Bırak / Konfirme et'. 'Bırak' seçilirse otele
bildirim taslağı hazırlanır — insan onaylar, kendi adresinden gider. Ana çatıya uygun."

**Levent:** "Aynı şey bende daha sert. TKT time limit genelde saatlerle ölçülür. Kart 'T-3 gün' değil, 'T-24 saat ve T-4 saat'
olmalı. Eşikler kural tablosunda."

**Kerem — allotment:** "Rakamla anlatayım: 18 ay önceden 120 oda × 3 gece blok, 165 EUR, attrition toleransı %15, release 60/30/14
gün. Kayıt pickup'ı T-60'ta 72 oda. Eğer T-60'ta 30 oda release edersen blok 90'a iner, tolerans 90'ın %15'i, yani 76,5 odanın
altına düşersen ceza başlar. Release etmezsen tolerans 120 üzerinden: 102 oda altı cezalı. 72 oda gerçekleşirse release'siz ceza
(102−72) × 3 × 165 = **14.850 EUR**; T-60 release ile (76,5−72) ≈ 4,5 × 3 × 165 ≈ **2.230 EUR**. Bu hesabı bir insan, doğru günde
yapmazsa 12.600 EUR uçar. Hedef 10'un ta kendisi."

**Serap:** "Bu yüzden attrition hesabı **domain'de saf fonksiyon** olmalı (packages/domain), parametreleri kontrattan ve rules
tablosundan gelir. AI hesaplamasın; AI yalnızca kontrat PDF'inden maddeyi ayıklasın, insan doğrulasın."

**Moderatör:** Ana çatı kontrolü: hesap domain'de, eşik rules'ta → uyumlu. Release'i otele **otomatik** göndermek → ANA ÇATI
ÇELİŞKİSİ (madde 6: konfirmasyon/dış mesaj). Alternatif: karar kartı + taslak + insan onayı.

**Hande:** "Bir şey daha: 'blok kaydı' sizin pickup verinizle beslenecekse ben de görmek isterim. Bugün rooming list'i T-7'de
alıyorum; T-30'da pickup görsem release'i birlikte planlarız."

**Nazlı:** "Rooming list misafir verisi. Pickup'ı **isimsiz sayı** olarak paylaşın: 'T-35, 78 oda kayıtlı, 64 DBL/14 SGL'. İsim yok."

**Kur tartışması.**

**Serap:** "İç para EUR — doğru karar. Ama Anadolu otelleri, transfer firmaları, yerel restoranlar TL fiyat veriyor. Yıllık %30+
enflasyonda TL teklif 30 gün geçerli; müşteriye 120 gün sonrası için EUR fiyat veriyoruz. Teklif günü kuru 37,50; ödeme günü 40,20
olsa, TL maliyetli kalemde EUR maliyetimiz düşer — lehimize; ama tedarikçi 60. günde 'fiyat güncellemesi' gönderirse aleyhimize. TL
fiyat geçerliliği bir **fiyat kilidi** alanı olmalı: orijinal para birimi, kur kaynağı/tarihi, 'fiyat şu tarihe kadar sabit', ve
kontratta 'TL sabit mi, endeksli mi'."

**Murat:** "Transferciler TL ister ama akaryakıta endekslerler. Benim sözleşmelerimde 'motorin litre fiyatı %10'dan fazla artarsa
fiyat revize' maddesi var."

**Kerem:** "Bir acenta sahibi 'bizim işimiz Anadolu'da, iç para TL olsun' diyecek."

**Moderatör:** ANA ÇATI ÇELİŞKİSİ (madde 7). Uyumlu alternatif: iç hesap EUR kalır; her kalemde orijinal para birimi ve tutar saklanır;
TL raporlama zaten ödeme/tahsilat günü kuruyla var; kiracıya "görüntüleme para birimi TL" seçeneği eklenebilir (ekleme, değişiklik değil).

**Serap:** "Bir de kur tamponu: TL maliyetli kalemlerde müşteri teklifine %x kur riski payı. Bu kural tablosunda ve teklifte
görünmez ama marj hesabında ayrı satır."

**Hande:** "Biz İstanbul'da EUR veriyoruz ama ödemeyi TL'ye çevirirken 'ödeme günü TCMB efektif satış' mı 'fatura günü' mü, her
acenta farklı yorumluyor. Kontrata yazın, sistem neyi esas aldığını göstersin. Kur farkı faturası en çok kavga ettiğimiz konu."

**Ayrışma (Tur 2):** Kur tamponunun müşteriye gösterilip gösterilmemesi. Serap: "gösterilmez, marjın parçası". Kerem: "kurumsal
müşteri kur maddesi ister, şeffaf olalım". → Ürün sahibine soru (Bölüm 4, S3).

---

### Tur 3 — "İyi fiyat" yanılgısı, OTA kıyası, rakip fiyatı ve tek tedarikçi

**Serap:** "Sistemin 'iyi fiyat' dediği şey üç yerden yanılır. (1) **Enflasyon:** 18 ay önce 2.000 TL'lik coffee break bugün 3.200;
TL medyanla kıyaslarsan her teklif 'pahalı' görünür. EUR'ya o günün kuruyla çevirsen bile TL'nin reel değer kaybı EUR'yu tam
izlemez. (2) **Sezon:** Ekim kongre haftası ile Ocak salı aynı kovaya girmemeli. (3) **Kapsam:** 'Coffee break' bir otelde 2 çeşit
kuru pasta, diğerinde 6 çeşit + taze sıkma meyve suyu. Kapsam etiketlemeden medyan anlamsız."

**Kerem:** "Bir dördüncüsü: **küçük örneklem.** Kapadokya'da 18 ayda 2 gala yemeği yaptık. Medyan iki sayı. Sistem buna 'normal'
derse ekip pazarlıktan vazgeçer."

**Önerilen düzeltme (Serap + Kerem):** Geçmiş fiyat kıyası (a) EUR'ya o günün kuruyla, (b) şehir × segment × sezon kovası (yüksek/omuz/düşük
ve hafta içi/sonu), (c) kapsam etiketi, (d) minimum örneklem n (varsayılan 5; altı "bilmiyorum"), (e) tek medyan değil **aralık**
(P25–P75) ve örnek sayısı, (f) kontrat fiyatı varsa **çıpa kontrat fiyatıdır**, geçmiş medyan ikincildir. Hepsi kural tablosunda.

**Elif:** "AV'de geçmiş fiyat neredeyse hiç işe yaramaz; her rider farklı. AV'de kıyas 'birim fiyat listesi' üzerinden olmalı —
LED panel m²/gün, kabin/gün, teknisyen/saat. Tedarikçinin yıllık birim fiyat listesi = AV'nin kontrat fiyatı."

**OTA kıyası — etik/yasal sınır.**

**Hande:** "OTA fiyatına benimle aynı koşulda bakın, eyvallah. Ama çoğu acenta iadesiz 'mobil özel' fiyatı esnek grup fiyatıyla
kıyaslıyor. Ve otomatik fiyat çekme (scraping) OTA'ların kullanım şartlarına aykırı olabilir."

**Serap:** "PRD bunu söylüyor: koşullar birebir aynı, iadesiz kıyaslanmaz. Uygulamada önerim: manuel giriş + **ekran görüntüsü kanıtı
+ zaman damgası + koşul alanları zorunlu** (tarih, oda tipi, pansiyon, iptal). Koşul alanlarından biri eksikse avantaj % hesaplanmaz."

**Levent:** "Havayolunda bu daha net: grup ücretini web fiyatıyla kıyaslamak çoğu zaman yanıltıcı; grup ücretinin değeri isim
esnekliği ve depozito yapısındadır. Uçuşa OTA avantaj tablosu uygulanmamalı."

**Kerem — pazarlıkta OTA argümanı:** "Pazarlık taslağında 'rakip fiyatı yasak' kuralı var, harika. Ama otelin **kendi** web fiyatını
hatırlatmak rakip fiyatı değildir. 'Sizin kendi sitenizde aynı tarih 180 EUR, grup teklifi 175 — grup avantajı yeterli değil'
meşru bir argüman."

**Hande:** "Meşru ama soğuk. Bunu telefonda söyleyin. Yazılı mailde 'web fiyatınız' dendiği an revenue müdürüne gider, o da 'BAR
farklı koşul' der, kapanır."

**Serap:** "Rakip fiyatı yazılı paylaşmak sadece ilişki değil, rekabet hukuku açısından da hassas — tedarikçiler arası fiyat bilgisi
taşımak 'bilgi değişimi' riski taşıyabilir [Doğrulanmalı: 4054 sayılı Kanun kapsamında hukukçu görüşü]. Otelin kendi kamuya açık
fiyatı bu riski taşımaz."

**Uzlaşma (Tur 3):** Otelin kendi kamuya açık fiyatı pazarlık argümanı olarak **acenta kuralı** olsun, varsayılan **kapalı**
(temkinli); açılırsa yalnız "kendi kanal fiyatınız" olarak, rakam yazmadan da kullanılabilir şablonla. Rakip fiyatı yasağı kalır.

**Tek tedarikçili destinasyonlar.**

**Murat:** "Bozcaada'da araç firması bir tane. Balon şirketi Kapadokya'da birkaç tane ama kapasite yüksek sezonda tek birinde kalıyor.
3–5 RFQ kuralı burada bürokrasi."

**Serap:** "PRD zaten gerekçeyle 1 RFQ'ya izin veriyor ve gerekçe haftalık raporda görünüyor. Eklenecek: tedarikçi kaydında 'tek kaynak'
etiketi + bölge; bu etiketle RFQ sayısı otomatik 1 önerilir, gerekçe tekrar istenmez; fiyat kıyası 'bilmiyorum' yerine 'tek kaynak —
kontrat/önceki yıl fiyatıyla kıyas'; risk kartı: 'Bu destinasyonda B planı yok'. Çözüm pazarlık değil, **çok yıllı kontrat**."

**Hande:** "Tek kaynak tedarikçi zaten bunu bilir. Onu skorla sıkıştırmayın, öngörülebilirlik verin: erken tarih, erken depozito."

---

### Tur 4 — Tedarikçi skoru, karşılıklılık, pazarlık tonu, uçak ve transfer uç durumları

**Tedarikçi skoru adil mi?**

**Hande:** "Yanıt hızı skoru beni haksız yere cezalandırır. Pazartesi 70 RFQ alıyorum; kongre teklifi 4 sayfa, fiyatı revenue ile
konuşmadan veremem. 6 saatte cevap veren küçük butik otel 'hızlı' görünür, ben 'yavaş'."

**Serap:** "Hız tek başına skor olmamalı. Önerim — bileşenler ve varsayılan ağırlıklar (kural tablosunda):
- Fiyat tutarlılığı (teklif → konfirmasyon → fatura farkı) %30
- Operasyon doğruluğu (olay kaydı: oda eksikliği, yanlış menü, rötar dışı transfer gecikmesi) %30
- Fatura doğruluğu (ilk faturada eşleşme) %15
- Yanıt süresi — **segment ve talep büyüklüğüne göre normalize** %15
- Esneklik (opsiyon uzatma, isim değişikliği kabulü) %10
Ve minimum veri: 3 tamamlanmış proje altında skor 'yetersiz veri'."

**Murat:** "Transferde rötar, tedarikçinin suçu değil. Olay kaydında 'kök neden: dış etken' alanı olmalı, skoru etkilememeli."

**Hande:** "Kötü bir dönemim olursa — yeni ekip, yangın tadilatı — o skor yıllarca peşimi bırakmaz mı? Silinebilsin."

**Moderatör:** Skorun silinmesi → ANA ÇATI ÇELİŞKİSİ (madde 3: silinmez kayıt). Alternatif: kayıt silinmez; skor **zaman ağırlıklı**
(ör. son 12 ay ağırlık 1, 12–24 ay 0,5, sonrası 0,2 — rules tablosunda) ve tedarikçi **itiraz notu** ekleyebilir, not skor kartında görünür.

**Skor tedarikçiye gösterilsin mi?**

**Kerem:** "Göster. Otel 'neden son 4 kongreyi alamadım' sorusunun cevabını bilirse düzelir."

**Serap:** "Gösterme. Skor iç değerlendirmedir; otelin elinde bir PDF 'acenta X bize 62 puan verdi' diye dolaşırsa ilişkiyi biz
yönetemeyiz. Ve sektörde acentalar aynı otelle çalışır; bir acentanın skoru başkasına sızarsa hukuki dert olur."

**Hande:** "Rakam değil, geri bildirim isterim: 'Son 3 projede fatura ilk seferde tutmadı.' Bunu satış müdürü olarak kullanırım."

**Ayrışma kayda geçti:** Kerem + Hande "paylaşılabilir performans özeti", Serap "yalnız iç". Uzlaşma önerisi: Skor iç kalır; insan
isterse sistem **nitel, olumlu çerçeveli performans özeti taslağı** hazırlar (rakam/puan yok), insan onayıyla kendi adresinden gider.
→ Bölüm 4, S5.

**Karşılıklılık — "Biz iyi müşteri miyiz?"**

**Hande'nin önerisi** herkesin desteğini aldı. **Kerem:** "Hedef 4'ün ölçüsü bu olmalı: tedarikçiye karşı sözümüzü tutma skoru."
Bileşenler: opsiyonu bitmeden bildirme oranı, release tarihine uyum, attrition cezası ödeme sıklığı, ödeme vadesine uyum (gün
sapması), konfirmasyon sonrası iptal oranı, RFQ başına kazanma oranı (otel başına "boşuna teklif" sayısı). **Serap:** "Son madde
kritik. Bir otele 12 RFQ atıp hiç iş vermiyorsak, o otel bize artık iyi fiyat vermez. Kısa liste algoritması 'son 10 RFQ'da 0 iş'
olan tedarikçiye uyarı versin: 'Bu otele 11. boş RFQ'yu atmak üzeresin.'"

**Pazarlık tonu ve tur sayısı.**

**Hande:** "Üç yazılı tur bir 5* otel için fazla. Bir yazılı tur + telefon."

**Serap:** "Butik tedarikçiyle 3 tur sorun değil, onlar mailden pazarlık eder. Tek kural herkese uymaz."

**Uzlaşma:** Tedarikçi kaydına **ilişki seviyesi**: Stratejik / Tercihli / İşlemsel. Varsayılan yazılı tur sınırı: Stratejik 1, Tercihli 2,
İşlemsel 3 (rules). Stratejik tedarikçide AI taslağı yerine "telefon görüşme notu şablonu" önerilir. Taslaklarda AI kalıp ifadeleri
yasak listesi (rules) ve sorumlu kişinin geçmiş maillerinden üslup.

**Ödeme koşulları.**

**Hande:** "Benim için ödeme takvimi fiyattan önemli. %30 kontratta, %40 T-60, %30 T-14 tipik. Geciken acentaya ikinci kongrede
depozitoyu %50 yaparım."

**Serap:** "Kontrattaki ödeme takvimi sistemde **ödeme planı** olarak saklanmalı; vadesinden T-5 gün ödeme talebi karar kutusuna
otomatik gelsin (Face ID ile onay — mevcut akış). Erken ödeme indirimi pazarlık argümanı olarak zaten 'ödeme kolaylığı' başlığında
var; sistem 'erken öde, %2 indirim' seçeneğini nakit akışıyla hesaplasın."

**Uçak — isim listesi ve time limit uç durumları.**

**Levent:** "Vaka: 46 kişilik grup, THY grup ücreti, isim listesi son tarihi T-21. Müşteri T-23'te 38 isim verdi, 8'i 'sonra'. T-21
geçti; 8 koltuk ya düşer ya da isim değişikliği ücretiyle sonradan girilir. Sistemde olması gereken: (1) uçuş kalemine bağlı
**isim listesi son tarihi**, (2) T-7, T-3, T-1 müşteri hatırlatma taslağı (insan onaylı), (3) T-1'de yöneticiye karar kartı: 'Eksik 8
isim — düşür / placeholder isimle ücreti göze al — tahmini kayıp X EUR'. (4) İsim yazımı kontrolü: rooming list ile pasaport adı
farklıysa ('Şükrü' vs 'SUKRU') uyarı."

**Nazlı:** "Dördüncü madde pasaport verisi. Model görmeyecek. Karşılaştırma deterministik olmalı: Türkçe karakter → ICAO
transliterasyonu, kod içinde."

**Levent:** "Bir de ücret kuralını AI okusun mu? Ücret kuralı metni (fare rules) misafir verisi değil; AI 'iade: ücretli, değişiklik:
X, no-show: Y' diye özetleyebilir, ama müşteriye giden 'iade edilir' cümlesi insan onaylı olmalı."

**Moderatör:** AI'nin bileti **otomatik** kesmesi (time limit dolmadan) → ANA ÇATI ÇELİŞKİSİ (madde 6: para hareketi/konfirmasyon).
Alternatif: time limit kartı + insan GDS'ten keser + PNR/bilet no sisteme işlenir.

**Levent — GDS entegrasyonu:** "Butik acentanın çoğu kendi GDS'ini kullanmaz, konsolidatörden alır. Büyük DMC Amadeus kullanır. v0.5'te
entegrasyon değil: **manuel PNR girişi + PNR metni yapıştırınca ayıklama** (PNR metni isim içerir — isim kısmı modele gitmemeli, ön
işlemde maskelenmeli) yeter. NDC/GDS API Faz 3."

**Transfer — rötar.**

**Murat:** "Gece rötarı meselesine dönelim. Ana çatı 'her dış mesaj insan onaylı' diyor; şoföre gece 02:40 mesajı kim onaylayacak?"

**Kerem:** "Kuralı delmeyelim. Mesaj göndermek yerine, transfer firmasına ve şoföre **giriş gerektirmeyen canlı manifest linki**
verelim — tedarikçi linki zaten var. Link uçuşun güncel tahmini iniş saatini gösterir. Mesaj gitmiyor; bilgi çekiliyor (pull)."

**Murat:** "Şoför linke bakmaz, WhatsApp'a bakar. Ama transfer firmasının operasyon masası bakar — onlar zaten FlightRadar'a bakıyor.
Link + saha sorumlusuna web push 'Rötar 95 dk, şoför bilgilendirme taslağı hazır — tek dokunuşla gönder' yeter. Saha sorumlusu gece
nöbetçi zaten."

**Moderatör:** Tek dokunuşlu onay ana çatıya uygun (insan onaylı, insanın adresinden). "Önceden onaylı şablonla tam otomatik
bildirim" ise ÇELİŞKİ — ürün sahibine ayrı soru (S1).

**Murat — eşikler:** "Ücretsiz bekleme dakikası, sonrası saatlik ücret, gece tarifesi (00–06 arası %25–50 fark), havalimanı otopark
ücreti — hepsi transfer kontratında, rules'ta varsayılan. Rötar olayı bekleme süresini sistem otomatik hesaplasın, faturadaki bekleme
ücretini doğrulasın — fatura okuma akışına bağlanır."

**Elif — AV uç durumu:** "Konuşmacı son gün 'iki ekran yerine üç' istedi. Rider eski olur, AV tedarikçisine revizyon taslağı, ek maliyet
saha ekstrası limitine (5.000/15.000 TL) takılır, müşteri link onayına gider. Mevcut akış yetiyor; eksik olan rider'ın veri olması."

---

### Tur 5 — Yakınsama: v0.5 için sektör geneli kararlar

**Serap:** "Önceliği para kaybına göre koyalım: attrition/release (onbinlerce EUR), uçak time limit/isim listesi (koltuk kaybı + ADM),
kontrat fiyatı (fiyat değişkenliği), opsiyon yönetimi. Bunlar P1."

**Kerem:** "Allotment modülü L efor; ama 'blok + release takvimi + attrition hesabı + pickup' çekirdeği M'de çıkar. Tam yönetim (çok
otelli şehir bloğu, sub-block) sonra."

**Levent:** "Uçuş kalemi alanları + time limit kartları S–M. GDS API P3."

**Murat:** "Transfer manifesti + araç planı + canlı link M. Uçuş durumu API'si için tedarikçi seçimi teknoloji komitesinde."

**Elif:** "AV gizli maliyet etiketleri S, rider belgesi M, P2."

**Nazlı:** "Vize/sigorta: v0.5'te yalnız 'belge/izin kalemi': tür, son tarih, durum, sorumlu, pasaport alanı şifreli, modele kapalı. P2.
Sigorta satışı değil takibi."

**Hande:** "Benden üç rica: RFQ'da bütçe aralığı veya en azından 'tarih esnekliği' alanı olsun — yoksa her talebe en yüksek fiyatı
veririm; red ederseniz bir satır neden yazın (fiyat/konum/müşteri vazgeçti) — sistem zaten kayıp nedeni topluyor, tedarikçiye de
nazikçe iletilebilsin; ve 24 saat hatırlatma büyük talepte 48 saat olsun."

**Serap:** "Bütçe aralığını ben vermem — çıpa olur, herkes tavana çıkar."

**Kerem:** "Bütçe değil 'hedef segment' ve 'tarih esnekliği ±n gün' verelim."

**Uzlaşma:** RFQ'ya isteğe bağlı 'tarih esnekliği', 'karar tarihi (müşteri)', 'talep olgunluğu (kesin/olasılık yüksek/keşif)' alanları.
Bütçe alanı acenta kuralı, varsayılan kapalı. Hatırlatma süresi talep büyüklüğüne göre kademeli (rules). Kaybedilen RFQ'da tedarikçiye
"teşekkür + neden kategorisi" taslağı, insan onaylı, rakip fiyat içermez.

**Ayrışma kalanlar:** (1) gece transfer bildiriminde tam otomasyon istisnası; (2) skorun tedarikçiyle paylaşımı; (3) kur tamponunun
müşteriye görünürlüğü; (4) otelin kendi web fiyatının yazılı pazarlıkta kullanımı; (5) çapraz-kiracı ortak tedarikçi profili (Hande:
"her acentaya ayrı ayrı aynı belgeleri yüklüyorum"). Son madde ana çatı 2 ile çelişiyor (Bölüm 5).

**Kapanış — Hande:** "Bir otelci olarak şunu söyleyebilirim: bu sistem, acentanın opsiyonu zamanında bırakmasını, release'e uymasını
ve ödemeyi takvimde yapmasını sağlarsa, size AI'den daha çok fiyat kazandırır. Biz iyi müşteriye iyi fiyat veririz."

**Serap:** "Ve kontrat fiyatı sisteme girerse, fiyat değişkenliği hedefi hayal olmaktan çıkar."

---

## 3) Kararlar

| # | Karar | Gerekçe | Hedef(ler) | Öncelik | Efor | v0.5? |
|---|---|---|---|---|---|---|
| K1 | **Kontrat fiyatı (yıllık anlaşmalı fiyat) kaydı:** tedarikçi × geçerlilik × sezon × oda tipi/pansiyon (otel), birim fiyat listesi (AV, transfer, F&B); statik veya dinamik (BAR −%x); blackout tarihleri; hacim taahhüdü ve ilerleme; orijinal para birimi + EUR. Talep geldiğinde önce kontrat kontrol edilir, kıyasta çıpa kontrat fiyatıdır. | Fiyat değişkenliğini azaltmanın birincil aracı; RFQ yükünü azaltır | 8, 10, 4, 1 | P1 | M | Evet |
| K2 | **Grup blokesi / allotment çekirdeği:** blok, release kademeleri, cut-off, attrition toleransı, pickup (isimsiz sayı), ücretsiz oda politikası (20+1 vb.); **attrition/release ceza hesabı `packages/domain`'de saf fonksiyon**; release tarihinden T-n gün önce karar kartı ("release et / tut") tahmini ceza tutarıyla. Release bildirimi taslak + insan onayı. | Tek kalemde 10.000+ EUR kayıp riski; kişiye bağlı Excel | 10, 2, 4, 6, 7 | P1 | M (tam modül L) | Evet (çekirdek) |
| K3 | **Opsiyon yönetimi:** opsiyon sırası (1./2. opsiyon), opsiyon uzatma talebi akışı, T-3 gün "Uzat / Bırak / Konfirme" kartı; uzatmada müşteri teklifi opsiyonu güncellenir ve teklif `stale` olur; "2. opsiyon" kalemi müşteri teklifinde uyarıyla gösterilir. | Opsiyon çakışması ve sessiz düşürme ilişkiyi bozar | 4, 2, 3 | P1 | S–M | Evet |
| K4 | **Uçuş kalemi alanları:** PNR, havayolu, grup/bireysel, ücret kuralı özeti (iade/değişiklik/no-show/isim değişikliği), depozito, **TKT time limit** ve **isim listesi son tarihi**; T-24s/T-4s (time limit) ve T-7/T-3/T-1 (isim listesi) kartları; tahmini kayıp tutarı. AI bilet kesmez; insan keser, bilet no işlenir. | Geri alınamaz hatalar, ADM, koltuk kaybı | 2, 10, 1 | P1 | M | Evet |
| K5 | **Deterministik isim eşleştirme:** rooming list / katılımcı adı ↔ pasaport adı (ICAO transliterasyonu) kodda; model kullanılmaz. PNR metni yapıştırıldığında isimler modele gitmeden maskelenir. | Bilet/vize hatası; KVKK | 2, 9 (ilke) | P1 | S | Evet |
| K6 | **"İyi fiyat" kıyasının düzeltilmesi:** geçmiş fiyat EUR'ya o günün kuruyla; şehir × segment × sezon × hafta içi/sonu kovası; kapsam etiketi; minimum örneklem n (vars. 5, rules); medyan yerine P25–P75 aralığı + örnek sayısı; kontrat fiyatı varsa çıpa. | Yanlış güven → pazarlıktan vazgeçme | 8, 10, 2 | P1 | M | Evet |
| K7 | **OTA kıyas disiplini:** manuel giriş + ekran görüntüsü + zaman damgası + koşul alanları zorunlu; eksik koşulda avantaj % hesaplanmaz; otomatik scraping yok; uçuşa OTA avantaj tablosu uygulanmaz. | Etik/ToS; yanıltıcı kıyas | 8, 2, 4 | P1 | S | Evet |
| K8 | **Fiyat kilidi alanları:** teklif para birimi, kur kaynağı/tarihi, "fiyat sabit şu tarihe kadar", TL sabit/endeksli (akaryakıt vb.), kontrattaki kur esası (fatura günü / ödeme günü); TL maliyetli kalemlerde **kur riski payı** (rules, marj hesabında ayrı satır). | TL enflasyonu ve kur farkı kavgası | 8, 10 | P1 | S–M | Evet |
| K9 | **Tedarikçi ödeme planı:** kontrattaki ödeme takvimi saklanır; vadeden T-5 gün ödeme talebi karar kutusuna (mevcut Face ID akışı); erken ödeme indirimi nakit akışı hesabı. | Ödemeye uyum = ilişki ve fiyat | 4, 10, 1 | P1 | S | Evet |
| K10 | **"Biz iyi müşteri miyiz?" karşılıklılık skoru:** opsiyon/release'e uyum, ödeme vadesi sapması, konfirmasyon sonrası iptal, attrition cezası sıklığı, tedarikçi başına boş RFQ sayısı; kısa listede "son 10 RFQ'da 0 iş" uyarısı. | Hedef 4'ün ölçülebilir karşılığı | 4, 6, 8 | P1 | M | Evet |
| K11 | **Tedarikçi skoru revizyonu:** bileşenler (fiyat tutarlılığı %30, operasyon doğruluğu %30, fatura doğruluğu %15, normalize yanıt süresi %15, esneklik %10 — rules); min. 3 proje; olayda kök neden "dış etken" skoru etkilemez; zaman ağırlıklı (decay); tedarikçi itiraz notu. Kayıt silinmez. | Adalet; büyük otel ↔ butik dengesizliği | 4, 2, 7 | P2 | M | Evet |
| K12 | **Tedarikçi ilişki seviyesi** (Stratejik/Tercihli/İşlemsel) ve buna bağlı yazılı pazarlık tur sınırı (vars. 1/2/3, rules), stratejikte telefon notu şablonu; taslaklarda kalıp ifade yasak listesi ve kişinin üslubu. | "Makineyle muhatap" hissi | 4, 8 | P2 | S | Evet |
| K13 | **RFQ iyileştirmeleri:** isteğe bağlı tarih esnekliği, müşteri karar tarihi, talep olgunluğu; bütçe alanı acenta kuralı (vars. kapalı); hatırlatma süresi talep büyüklüğüne göre kademeli (rules); kaybedilen RFQ'da teşekkür + neden kategorisi taslağı (insan onaylı, rakip fiyatsız). | Tedarikçinin zamanına saygı, daha doğru fiyat | 4, 3, 8 | P2 | S | Evet |
| K14 | **Tek kaynak etiketi:** tedarikçi + bölge için; RFQ sayısı otomatik 1 önerilir (gerekçe tekrar istenmez, raporda etiketle görünür); kıyas "tek kaynak — kontrat/önceki yıl"; "B planı yok" risk kartı; çok yıllı kontrat önerisi. | Gereksiz bürokrasi ve yanlış "bilmiyorum" | 1, 8, 2 | P2 | S | Evet |
| K15 | **Transfer operasyon çekirdeği:** uçuş manifesti (isim yerine katılımcı ref.) → araç planı (kapasite kuralları) → karşılama listesi → şoför/araç ataması; tedarikçiye **canlı manifest linki** (giriş yok, güncel tahmini iniş); rötarda saha sorumlusuna web push + tek dokunuşla şoför bildirim taslağı; bekleme/gece tarifesi kuralları rules'ta; faturadaki bekleme ücretini rötar kaydıyla doğrulama. | Gece rötarı, bekleme parası, karşılama hatası | 2, 1, 10 | P2 | M–L | Evet (manifest + link + kart); uçuş API'si teknoloji komitesine bağlı |
| K16 | **AV/mekân:** gizli maliyet etiketleri (in-house AV zorunluluğu, harici AV giriş ücreti, elektrik kVA, yük asansörü, kurulum gecesi kirası, rigging); AV normalizasyonu paket/gün + kurulum/prova/söküm; **teknik rider veriden üretilen belge**, değişince `stale`. | Gizli maliyetler kârı yer; rider sürüm karmaşası | 10, 2, 9 | P2 | S (etiket) / M (rider) | Evet |
| K17 | **Vize/sigorta "belge/izin kalemi":** tür, ülke, son tarih, randevu, durum, sorumlu; davet mektubu/konfirmasyon belgesi veriden üretilir; pasaport verisi şifreli ve modele kapalı; ret → bağlı uçak/otel/transfer kalemlerinde iptal koşulu kartı. Poliçe **takibi**, satış değil. | Takvim zincirinin en kırılgan halkası | 1, 2, 5 | P2 | M | Evet (temel) |
| K18 | **Tedarikçi ile isimsiz pickup paylaşımı:** blok tedarikçi linkinde T-n pickup sayısı (oda tipi bazında, isim yok), insan onayıyla görünür. | Release'i birlikte planlama | 4, 2 | P3 | S | Hayır (v0.6) |
| K19 | **GDS/NDC ve uçuş durumu API entegrasyonu**; muhtemel konsolidatör entegrasyonu. | Büyük DMC ölçeği | 1, 2 | P3 | L | Hayır |
| K20 | **Tam allotment yönetimi:** şehir çapında çok otelli blok, sub-block, kongre konut bürosu (housing) senaryosu. | PCO segmenti | 10, 1 | P3 | L | Hayır |

---

## 4) Ürün sahibine sorular

**S1 — Gece/acil operasyon bildirimi (transfer rötarı, son dakika değişiklik)**
- A) Ana çatı aynen: her mesaj tek dokunuşla insan onaylı; nöbetçi saha sorumlusu + canlı manifest linki (K15).
- B) "Önceden onaylı operasyon şablonu" istisnası: yalnız tedarikçiye, yalnız saat/uçuş bilgisi, kural yöneticide; tam otomatik.
- C) A + kurala bağlı eskalasyon: 10 dk onaylanmazsa vekile/yöneticiye push (yine insan onayı).
- **Öneri: C.** Ana çatıyı korur, gece riskini kapatır. B ana çatı 6'yı değiştirir (Bölüm 5, Ç1).

**S2 — Allotment kapsamı v0.5'te**
- A) Çekirdek (K2) — blok, release, attrition hesabı, kart. B) Tam modül (K20 dahil). C) v0.6'ya ertele.
- **Öneri: A.** En büyük para kaybını M eforla kapatır.

**S3 — Kur riski payı müşteriye görünsün mü?** `[Ürün kararı]`
- A) Görünmez, marjın parçası. B) Teklifte "kur farkı maddesi" (EUR sabit, TL endeksli vb.) olarak görünür. C) Acenta kuralı, varsayılan A.
- **Öneri: C** (temkinli varsayılan; kurumsal müşteride B açılabilir). Hukuk/finans komitesiyle madde metni.

**S4 — Otelin kendi kamuya açık fiyatı yazılı pazarlık argümanı olabilir mi?** `[Ürün kararı]` `[Doğrulanmalı]`
- A) Hayır, yalnız telefonda. B) Evet, rakamsız şablonla. C) Acenta kuralı, varsayılan kapalı.
- **Öneri: C.** Rakip fiyatı yasağı her durumda kalır.

**S5 — Tedarikçi skoru tedarikçiyle paylaşılır mı?**
- A) Asla. B) Nitel, puansız performans özeti taslağı; insan onayıyla. C) Tedarikçi linkinde kendi skorunu görür.
- **Öneri: B.** Komitede ayrışma vardı (Serap A, Kerem+Hande C); B ortak zemin.

**S6 — Uçak bileti v0.5 derinliği**
- A) Yalnız uçuş kalemi alanları + time limit/isim listesi kartları (K4–K5). B) A + PNR metni ayıklama. C) GDS/NDC entegrasyonu.
- **Öneri: B** (isim maskeleme şartıyla); C Faz 3.

**S7 — Vize/sigorta ürün kapsamında mı?**
- A) Belge/izin kalemi (K17). B) Partner (vize firması) yönlendirmesi, sistem yalnız tarih tutar. C) Kapsam dışı.
- **Öneri: A**; sigortada satış değil takip (aracılık mevzuatı `[Doğrulanmalı]`).

**S8 — RFQ'da bütçe alanı**
- A) Hiç yok. B) Acenta kuralı, varsayılan kapalı. C) Zorunlu aralık.
- **Öneri: B.**

**S9 — Karşılıklılık skoru (K10) kimlere görünür?**
- A) Yalnız yönetici. B) Yönetici + ekip (kendi projeleri). C) Ekip performans raporuna da girer.
- **Öneri: C** — hedef 6 ve 4'ü kişiye değil sisteme bağlar; ekip performans raporuna "tedarikçiye sözünü tutma" bileşeni.

---

## 5) Ana çatı çelişkileri

| # | Öneri (kimden) | Çelişen madde | Neden | Uyumlu alternatif |
|---|---|---|---|---|
| Ç1 | Rötarda şoför/transfer firmasına tam otomatik bildirim (Murat) | 6 — dış mesaj insan onaylı | Onaysız dış mesaj | Canlı manifest linki (pull) + web push + tek dokunuş onay + eskalasyon (S1-C) |
| Ç2 | TKT time limit dolmadan sistemin bileti otomatik kesmesi (salonda dile getirildi) | 6 — para hareketi/konfirmasyon yasak | AI/otomasyon konfirmasyon ve ödeme yapamaz | Time limit kartı; insan GDS'ten keser; bilet no işlenir |
| Ç3 | Release'in/opsiyon bırakmanın otele otomatik iletilmesi | 6 (ve 5) | Dış mesaj + sözleşmesel sonuç | T-n karar kartı + taslak + insan onayı |
| Ç4 | Pasaport fotoğrafının AI ile okunması (OCR) | 9 — misafir verisi modele gitmez | PII | Yerel/deterministik MRZ okuma (model dışı) veya elle giriş; şifreli saklama |
| Ç5 | İç para biriminin kiracıya göre TL olabilmesi | 7 — iç para EUR | Hesap tutarlılığı | İç hesap EUR; orijinal para birimi saklanır; TL raporlama/görüntüleme ek seçenek |
| Ç6 | Kötü dönem tedarikçi skorunun silinmesi (Hande) | 3 — silinmez kayıt | Denetim izi | Zaman ağırlıklı skor (decay, rules) + tedarikçi itiraz notu |
| Ç7 | Sektör geneli ortak tedarikçi profili / skorun acentalar arası paylaşılması (Hande) | 2 — kiracı izolasyonu | Kiracılar arası veri | Tedarikçinin kendisine ait, kiracı dışı, rızaya dayalı "tedarikçi belge kasası" (ayrı sınır, yalnız tedarikçinin kendi yüklediği belgeler; acenta verisi/skor asla paylaşılmaz) — ürün sahibine ayrı soru, Faz 3 |
| Ç8 | Bekleme süreleri, attrition toleransı, hatırlatma süreleri gibi eşiklerin koda yazılması (geliştirme kolaylığı) | 8 — kurallar tabloda | Yönetici değiştirebilmeli | Tüm eşikler `rules`; `DEFAULT_RULES` yalnız varsayılan |
| Ç9 | Tedarikçiye kalıcı hesaplı portal | (PRD karma model kararı; ana çatı değil) | Tedarikçi zorlanmaz | Giriş gerektirmeyen link kalır; isteğe bağlı hesap eklemeli özellik olabilir |

---

## 6) Diğer komitelere sorular / bağımlılıklar

- **Finans / muhasebe:** Kur esası (fatura günü / ödeme günü) kontrat maddesi; kur riski payının marj raporunda ayrı satır gösterimi;
  attrition cezası ve rebate (hacim primi) faturalarının muhasebeleşmesi ve Mikro dışı programlara aktarım; erken ödeme indirimi
  nakit akışı modeli; tedarikçi depozitolarının "ödenmiş avans" takibi.
- **Hukuk / KVKK:** Rekabet hukuku açısından tedarikçi fiyat bilgisi taşınması (4054) `[Doğrulanmalı]`; OTA kullanım şartları ve
  ekran görüntüsü kanıtının saklanması; seyahat sigortası aracılık mevzuatı `[Doğrulanmalı]`; pasaport verisi saklama süresi ve
  rıza metni; tedarikçi skoru paylaşımının hukuki sonuçları; Ç7 için kiracı dışı tedarikçi kasasının veri sorumluluğu.
- **Operasyon / saha:** Transfer manifesti ve karşılama listesinde hangi misafir alanlarının şoföre görüneceği (ad + uçuş, telefon yok?);
  gece nöbetçi saha sorumlusu ve eskalasyon zinciri (S1); saha ekstrası akışının AV rider değişikliğiyle bağlanması.
- **Müşteri / satış:** Tedarikçi opsiyon sırası ("2. opsiyon") müşteri teklifinde nasıl ifade edilir; isim listesi son tarihinin
  müşteri sözleşmesine ve teklife yazılması; kur farkı maddesi (S3); vize reddi durumunda müşteriye iade politikası.
- **Teknoloji / AI:** Uçuş durumu API'si seçimi ve maliyeti; PNR metni ayıklamada isim maskeleme ön işlemi; MRZ okumanın model dışı
  yapılması; attrition/release hesabının `packages/domain` testleri; kontrat PDF'inden madde ayıklamada güven puanı ve insan doğrulaması;
  yeni tablolar için `apply_standard_policies` + `apply_tenant_foreign_keys` ve migration numaraları.
- **SaaS / ürün:** Sektör geneli varsayılan kural setleri (butik vs DMC vs PCO profilleri: RFQ sayısı, tur sınırı, release uyarı
  günleri); tedarikçi onboarding'inin acenta onboarding'ine etkisi (ilk veri yükünde kontrat fiyatlarının içe aktarımı); Ç7 kararının
  ticari modeli (tedarikçi tarafında ağ etkisi).
- **Kongre/PCO komitesi (varsa):** Housing bürosu senaryosu (K20), katılımcı kayıt sisteminden pickup verisinin beslenmesi.
