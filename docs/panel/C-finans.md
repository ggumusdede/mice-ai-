# Komite C — Finans: müzakere tutanağı ve kararlar

> Kapsam: MICE AI Operations OS, PRD v0.4 (özellikle §7 Adım 7–8, §17 md. 3, 4, 8) ve BRIEF.md'deki "bugün olanlar / olmayanlar".
> Odak hedefler: **10** (hesap hatası, kârlılık, gelir-gider kontrolü), **2** (hata azaltma), **6** (kontrol kişide değil sistemde), **7** (kurum hafızası).
> Not: Vergi/hukuk ifadeleri komite üyelerinin saha deneyimine dayanır; mevzuat sık değiştiği için `[Doğrulanmalı]` işaretli her madde,
> ürüne kural olarak girmeden önce bir SMMM/YMM ve gerekirse özelge ile teyit edilmelidir. Tüm örnek kurlar (ör. 1 EUR = 45,00 TL) **temsilîdir**.

---

## 1) Katılımcılar

| # | Rol | Kişi (temsilî) | Geçmiş ve masaya getirdiği deneyim |
|---|-----|----------------|-------------------------------------|
| 1 | **Finans Direktörü** | Nermin Aksoy | 22 yıl; iki DMC ve bir kongre organizatöründe CFO. 2018 kur şokunda TL sabit fiyatlı 1.400 kişilik bir kongreyi zararına çıkarmış; "kur riskini teklifte yönetmeyen acenta, kârını bankaya bağışlar" der. |
| 2 | **Mali Müşavir (SMMM)** | Hakan Türkmen | 18 yıl; 40'tan fazla seyahat acentası ve tur operatörü müşterisi. KDV iadesi, hizmet ihracatı, kur farkı faturası ve vergi incelemesi tecrübesi. Bir müşterisinin "aracılık" diye beyan ettiği işin incelemede "kendi nam ve hesabına satış" sayılıp tam matrah üzerinden KDV tarhiyatı yediğini anlatır. |
| 3 | **Fatura Takip Uzmanı 1** | Derya Çelik | Büyük bir DMC'de 9 yıl; ayda ~1.200 tedarikçi faturası. "Faturanın üç tarihi vardır, otelin dördüncüsü de vardır." |
| 4 | **Fatura Takip Uzmanı 2** | Emre Yıldız | Butik teşvik acentasında 6 yıl; hem fatura hem banka hem kasa tek kişide. Küçük acentanın gerçeğini temsil eder. |
| 5 | **Muhasebe Programı Uzmanı — Logo/Netsis** | Serkan Bal | 15 yıl Logo iş ortağı (Tiger, Go3, Netsis 3). Cari kod yapısı, Logo Objects, aktarım şablonları. |
| 6 | **Muhasebe Programı Uzmanı — Mikro** | Gülşen Arı | 12 yıl Mikro bayi danışmanı (Run/Jump/Fly, e-Dönüşüm). Mevcut pilot acentanın programını iyi bilir. |
| 7 | **Muhasebe Programı Uzmanı — Bulut/Müşavir** | Tolga Er | Paraşüt, Luca, Zirve; müşavir bürolarına danışmanlık. "Küçük acentanın muhasebesi ofiste değil, müşavirin Luca'sındadır." |
| 8 | **İç Denetçi** | Aylin Korkmaz | CIA; Big4 + holding iç denetimi. Bir turizm şirketinde sahte IBAN değişikliğiyle (BEC dolandırıcılığı) 186.000 EUR'luk ödeme kaybını incelemiş. |
| 9 | **Hazine / Nakit Akış Uzmanı** | Murat Kaya | 14 yıl; otel zinciri ve etkinlik şirketinde hazine. 13 haftalık kayan nakit akış, forward, döviz pozisyonu. |
| 10 | **Dış ses: Banka KOBİ/Ticari Müşteri Temsilcisi** | Selin Öztürk | Özel bankada 11 yıl ticari şube; portföyünün üçte biri turizm. Döviz hesabı, kur, teminat mektubu, akreditif, POS/sanal POS, MT940 ekstre. |
| — | Moderatör | (komite sekreteryası) | Ana çatı denetimi ve tutanak. |

---

## 2) Tartışma tutanağı

### Tur 1 — Mevcut sistemin hedef 10, 2, 6, 7'ye göre değerlendirilmesi

**Moderatör** brifingi özetledi: sistem bugün tedarikçi faturasını okuyup sözleşme kalemine bağlıyor, tutar farkında alarm veriyor, her ödemeyi
yöneticinin Face ID onayına getiriyor, banka ekstresiyle eşleştiriyor, Mikro'ya Excel aktarıyor, e-Fatura UBL okuyor, gerçekleşen kârı ödeme/tahsilat
günü TCMB kuruyla EUR ve TL hesaplıyor, kapanış kontrol listesi var.

**Nermin Aksoy (Finans Direktörü):** "Bu iskelet doğru yerde başlamış: belge veriden üretiliyor, marj ve markup ayrı, ödeme tek tek onaylı.
Ama şu an sistem bir *muhasebe arka ofisi* gibi, *hazine* gibi değil. Bana 'bu proje kârlı mı' sorusunun cevabını veriyor; 'önümüzdeki altı hafta
kasada para olacak mı' sorusunun cevabını vermiyor. MICE'ta acentayı batıran kârsız proje değil, kârlı ama nakdi ters dönen projedir.
Müşteri bakiye ödemesini etkinlikten 30 gün sonra yapar, otel yüzde 100'ü etkinlikten 14 gün önce ister. Arada 44 gün acenta bankadır."

**Murat Kaya (Hazine):** "Somut eksik listem: (1) para birimi bazında nakit akış tahmini, (2) müşteri tahsilat planı — kapora, ara ödeme, bakiye —
ayrı bir nesne olarak, (3) tedarikçi ödeme planı, (4) açık döviz pozisyonu. Sistem vade takvimini sözleşmeden çıkarıyor, güzel; ama bu takvim
şu an tek tek ödeme taleplerine dönüşüyor, bir *toplam görünüme* dönüşmüyor."

**Hakan Türkmen (SMMM):** "Benim en büyük endişem vergisel nitelik. Seyahat acentası aynı projede üç farklı hukuki rolde olabilir:
kendi nam ve hesabına paket satan (tüm bedel matrah), başkası nam ve hesabına aracılık eden (yalnız komisyon matrah) ve müşteri adına
ödeyip masrafı yansıtan. Sistem 'markup' diye tek bir kâr kavramı tutuyor; bu yönetim için doğru, vergi için yetersiz. Hangi kalemin hangi
modelde faturalanacağı teklif aşamasında bilinmezse, müşteri faturası taslağı yanlış çıkar. Türkiye'de AB'deki gibi genel bir 'tur operatörü
marj rejimi' (TOMS) yok; seyahat acentasının satışında KDV matrahının tam bedel mi yoksa komisyon mu olduğu işin kurgusuna bağlı
`[Doğrulanmalı]`. Bunu yanlış kuran acenta incelemede tarhiyat yer — bir müşterimde yaşandı."

**Derya Çelik (Fatura Takip 1):** "Sahada en çok kırılacak yer tarihler. Bir otel faturasının düzenleme tarihi, hizmet (konaklama) tarihi,
bize ulaştığı/kayda alındığı tarih ve vadesi ayrı. KDV dönemi hizmet ve fatura tarihine göre, nakit planı vadeye göre, kur farkı
ödeme tarihine göre. Bugünkü fatura okuma ekranı tek 'tarih' alanı mı tutuyor bilmiyorum; tutuyorsa yanlış. Bir de otellerin 'proforma'
gönderip sonra 'kesin fatura' göndermesi var; ikisi aynı faturaymış gibi eşleşirse mükerrer ödeme çıkar."

**Emre Yıldız (Fatura Takip 2):** "Benim acentamda 'kasa' diye ayrı bir dünya var. Saha ekibi Kapadokya'da balon şirketine nakit öder,
şoföre bahşiş verir, eczaneden ilaç alır. Sistemde saha ekstrası var ama 5.000/15.000 TL limiti *müşteriye yansıtılacak* ekstra için.
Personelin iş avansı, avansın kapatılması, fişin fotoğrafı, artan avansın iadesi — hiçbiri yok. Ayrılan bir saha sorumlusu 23.000 TL avansı
kapatmadan gitti; altı ay sonra fark ettik. Hedef 7 tam burası."

**Aylin Korkmaz (İç Denetçi):** "Kontrol ortamı açısından iyi başlangıç: silinmez kayıt, denetim izi, Face ID, tek tek ödeme onayı.
Eksikler: görev ayrılığı (ödeme talebini giren kişi ile onaylayan aynı kişi olabiliyor mu?), tedarikçi banka bilgisi (IBAN) değişikliği kontrolü,
mükerrer ödeme kontrolü (aynı tedarikçi + aynı tutar + yakın tarih), ve dönem kilidi. Muhasebeye aktarılmış, KDV beyannamesi verilmiş bir
dönemin belgesi 'stale' olup yeniden üretilebiliyorsa, muhasebe ile sistem arasında sessiz bir fark doğar. 186.000 EUR'luk vakada dolandırıcı
gerçek tedarikçinin e-postasını taklit edip 'banka değiştirdik' yazmıştı. Onay veren yönetici IBAN'ın değiştiğini ekranda görmedi bile."

**Selin Öztürk (Banka, dış ses):** "Dışarıdan bir gözlem: sistem TCMB kuruyla gerçekleşen kâr hesaplıyor. Bankada müşterim EUR'yu TCMB
kurundan bozdurmaz. Ticari müşteri için banka satış kuru ile TCMB döviz satış kuru arasında gün içinde %0,5–1,5 fark olabilir; küçük
tutarlarda ve gün sonu işlemlerde daha da açılır. 2 milyon TL'lik bir projede bu 20–30 bin TL eder; bu kâr ya da zarar, raporda
görünmeyecek. Bir de ekstre: bankalar MT940, bazıları CAMT.053, çoğu KOBİ Excel indirir ve her bankanın Excel'i farklıdır."

**Gülşen Arı (Mikro):** "Mikro Excel aktarımı pilot için yeterli; ama 'Mikro' tek bir ürün değil — Run, Jump, Fly ve e-Dönüşüm modülü farklı.
Cari kod yapısını acenta kendisi kurar: kimi '320.01.0001', kimi 'T-OTEL-0042'. Sistem cari kodu tahmin etmeye çalışırsa ilk ay yüzlerce
'bilinmeyen cari' çıkar."

**Serkan Bal (Logo/Netsis):** "Ürün sektöre satılacaksa Mikro'ya özel aktarım bir teknik borçtur. Türkiye'de KOBİ muhasebesinin büyük
kısmı Logo ve Mikro'dadır; Netsis büyük acentalarda yaygın, bulutta Paraşüt ve müşavir tarafında Luca/Zirve. Beş ayrı entegrasyon yazmak
yerine bir 'kanonik muhasebe fişi' modeli kurulmalı, programa özel kısım ince bir adaptör olmalı."

**Tolga Er (Bulut/Müşavir):** "Unutmayın: küçük acentanın muhasebecisi şirkette değil. Müşavir ayda bir gelir, belgeleri toplar, Luca'ya
girer. Bu kullanıcı için en değerli şey 'aylık müşavir paketi': tek tıkla, o ayın alış/satış faturaları, banka hareketleri ve proje (masraf
merkezi) kırılımıyla bir Excel + PDF zip."

**Moderatör özeti (Tur 1):** Güçlü yanlar: tek doğru kaynak, onay kapıları, silinmez kayıt, marj/markup ayrımı. Boşluklar: nakit akış
ve ödeme planları, kur riskinin teklif aşamasında görünmemesi, vergisel faturalama modeli, çoklu tarih, kur farkı, avans/kasa, ödeme güvenliği
(IBAN, mükerrer, görev ayrılığı), dönem kilidi, çoklu muhasebe programı.

---

### Tur 2 — Kur, kur farkı ve "hangi kur?" kavgası (somut rakamlarla)

**Hakan Türkmen** tahtaya ilk örneği yazdı:

> **Örnek A — EUR borç, EUR ödendi.** Otel 10.000 EUR + KDV fatura kesiyor (fatura tarihinde TCMB döviz alış kuru 45,00 →
> muhasebe kaydı 450.000 TL + KDV). Acenta 30 gün sonra EUR hesabından 10.000 EUR + KDV öder; o gün kur 46,20.
> Taraflar arasında **kur farkı faturası yoktur**; borç EUR olarak kapandı. Acentanın defterinde ise kur farkı gideri/geliri (kambiyo
> zararı/kârı) oluşur: 10.000 × (46,20 − 45,00) = 12.000 TL kambiyo zararı (KDV tarafı da ayrıca değerlenir) `[Doğrulanmalı: KDV kısmının
> döviz/TL tutulma biçimi faturaya göre değişir]`.

> **Örnek B — EUR fatura, TL ödendi.** Aynı fatura, ama acenta TL öder ve sözleşmede "ödeme günü kuru" var. Ödeme günü kur 46,20 →
> acenta 462.000 TL (+ KDV etkisi) öder. Bu durumda tedarikçi acentaya 12.000 TL'lik **kur farkı faturası** keser; kur farkı KDV'ye tabidir
> ve genel uygulamada fark tutarı KDV dahil kabul edilerek iç yüzde ile matrah ayrıştırılır `[Doğrulanmalı: KDV GUT'taki güncel düzenleme
> ve iç yüzde uygulaması]`. Tersi müşteride de olur: müşteriye EUR fatura kesip TL tahsil edersek kur farkı faturasını **biz** keseriz
> (kur lehimize döndüyse) — ya da müşteri bize keser (aleyhimize).

**Derya Çelik:** "Sahada kur farkı faturası en çok unutulan belgedir. Biz unutursak gelir kaybı; tedarikçi unutup üç ay sonra hatırlarsa
kapanmış projenin kârı değişir. Sistem 'belge para birimi ≠ ödeme para birimi' gördüğü anda bir *kur farkı faturası bekleniyor* kartı açmalı."

**Selin Öztürk:** "Burada bankanın kuru da işin içinde. Örnek B'de acenta TL ile ödeme yaptıysa sorun yok, TL çıktı. Ama EUR hesabından
ödemek için önce TL'den EUR aldıysa, aldığı kur bankanın kuru — diyelim 46,45. TCMB 46,20. Aradaki 2.500 TL ne vergi belgesinde ne
TCMB'li kâr raporunda görünür; sadece banka ekstresinde görünür."

**Nermin Aksoy:** "O yüzden ben kesin konuşuyorum: **yönetim kârlılığı fiili kurla** ölçülmeli. Ürün sahibinin 'TL kârlılık ödeme/tahsilat
günü kuruyla' kararı doğru ruhta; ama 'ödeme günü kuru' TCMB değil, paranın gerçekten el değiştirdiği kur olmalı."

**Hakan Türkmen:** "Katılmıyorum, en azından tek başına değil. Vergi tarafında VUK değerleme için TCMB döviz alış kuru esastır
(dönem sonu değerleme, VUK md. 280) `[Doğrulanmalı]`; faturadaki TL karşılığı için de uygulamada TCMB kuru kullanılır. Yönetim raporu
fiili kurla, defter TCMB ile çalışırsa ay sonunda müşavir ile finans direktörü 'kâr kaç' diye kavga eder. İki rakamı **yan yana** göstermek
zorundasınız ve farkı 'banka kur marjı' diye açıklamalısınız."

**Murat Kaya:** "Bir üçüncü kur daha var: **teklif/bütçe kuru**. Teklifi 15 Mart'ta 45,00 ile yaptık, etkinlik 20 Haziran'da. Beklenen kâr
45,00 ile; gerçekleşen kâr fiili kurla. Aradaki fark 'kur sapması' olarak plan–gerçekleşen raporuna ayrı satır girmeli. PRD Adım 8 'kur farkı'
diye bir sapma nedeni sayıyor ama bunu ölçecek veri yok."

**Moderatör:** Toplamda dört kur kavramı çıktı. Uzlaşma: (1) *teklif/bütçe kuru* (beklenen kâr), (2) *belge kuru* (fatura tarihi TCMB, VUK
amaçlı), (3) *fiili kur* (banka dekontu/ekstreden), (4) *değerleme kuru* (dönem sonu, yalnız muhasebe aktarımında ve açık pozisyon
raporunda). İç para birimi EUR değişmiyor; tüm kurlar kaynak para birimiyle birlikte saklanıyor. **Ana çatı 7 ile uyumlu.**

**Nermin Aksoy:** "Tamam, ama ekranda dört kur gösterirseniz yönetici telefonda boğulur. Yöneticinin kartında tek rakam: fiili kurla
gerçekleşen kâr. Dokununca kırılım."

**Kur riski — teklif aşaması.** **Murat Kaya** ikinci örneği verdi:

> **Örnek C.** Yurtiçi bir ilaç firmasına 300 kişilik toplantı, maliyet 120.000 EUR (otel EUR fiyat veriyor). Müşteri satın alması TL
> teklif istiyor. %15 markup → satış 138.000 EUR; 45,00 ile 6.210.000 TL sabit teklif. Etkinlik 90 gün sonra, ödemeler etkinlikten sonra.
> Kur %6 yükselirse (47,70) maliyet 5.724.000 TL; teklif 6.210.000 TL. Kâr 18.000 EUR'dan ~10.200 EUR'ya (TL bazında 810.000 → 486.000 TL)
> iner; **marj %13'ten %7,8'e** düşer. Hedef marj altına düşen bir teklifi sistem bugün teklif anında blokluyor; ama kur yüzünden
> *sonradan* hedef marj altına düşen projeyi kimse görmüyor.

**Nermin Aksoy:** "2018'de bu oldu. Teklif TL, maliyet EUR, ödeme etkinlik sonrası. Kâr eridi, üstüne müşteri 60 gün geç ödedi.
Çözüm üç seçenekli bir 'kur politikası' alanı: teklif EUR; teklif TL + 'ödeme günü TCMB döviz satış kuru' maddesi; ya da TL sabit + kur tamponu
(örn. %4). Tampon oranı kural tablosunda, yönetici değiştirir."

**Selin Öztürk:** "Banka tarafında bunun cevabı forward (vadeli döviz alım). Ticari müşteriye 3 aylık EUR forward veririz, ama limit tahsisi
ister, teminat ister. KOBİ acentaların çoğu forward kullanmaz, çünkü kredi limitini yer. Gerçekçi olan: EUR tahsilat ve EUR ödemeyi
eşlemek — 'doğal hedge'."

**Moderatör (ana çatı denetimi):** Bir üye sistemin "kur %3 oynayınca otomatik forward talimatı" vermesini önerdi.
**ANA ÇATI ÇELİŞKİSİ (madde 6 — AI para hareketi yapamaz; madde 5 — para onayı Face ID).** Uyumlu alternatif: sistem açık pozisyonu ve
eşik aşımını karar kutusuna *uyarı kartı* olarak koyar; hedge kararı ve banka talimatı insanda, bankanın kendi kanalında. Öneri geri çekildi.

---

### Tur 3 — Kapora, ön ödeme, nakit ve müşteri riski

**Murat Kaya** nakit örneğini kurdu:

> **Örnek D.** Proje satış 200.000 EUR, maliyet 170.000 EUR. Sözleşme: müşteri %50 kapora (100.000 EUR) etkinlikten 45 gün önce,
> bakiye etkinlikten 15 gün sonra. Otel: %30 ön ödeme (otel payı 120.000 EUR → 36.000 EUR) opsiyon bitişinde (etkinlikten 60 gün önce),
> kalan %70 etkinlikten 7 gün önce. Müşteri kaporası **20 gün gecikti**.
> Nakit çizelgesi: T−60: −36.000; T−45: +100.000 bekleniyordu, gelmedi; T−25: kapora geldi +100.000; T−7: otel −84.000;
> diğer tedarikçiler T−7…T+10 arası −50.000; T+15: bakiye +100.000.
> Kapora gecikmesi yüzünden T−60 ile T−25 arasında acenta 36.000 EUR'yu kendi cebinden taşıdı; aynı dönemde başka iki projenin ön ödemesi
> denk gelirse açık 110.000 EUR'ya çıkar.

**Emre Yıldız:** "Bizim gibi küçük acentada 110.000 EUR'luk açık, KMH (kredili mevduat) faiziyle döner. Yıllık %50 civarı TL faiz ortamında
bu, kârın ciddi bir kısmını yer. Hiçbir rapor bize 'bu proje finansman maliyeti yüzünden %3 marj kaybetti' demedi."

**Nermin Aksoy:** "Bir kural öneriyorum: **'Kapora gelmeden tedarikçiye ön ödeme yapılmaz.'** Ödeme talebi karar kutusuna geldiğinde,
müşteri kaporası tahsil edilmemişse kart kırmızı olsun, net proje nakit pozisyonunu göstersin."

**Derya Çelik:** "Pratikte bu kural sert olursa otel opsiyonunu kaybederiz. Otel 'cuma 17:00'ye kadar %30 yoksa blokeyi bırakırım' der;
müşterinin satın alması da PO'yu pazartesi çıkarır. Yönetici bilerek risk alabilmeli."

**Aylin Korkmaz:** "O zaman kural *uyarı + gerekçeli istisna* olmalı. İstisna Face ID ile onaylanır, gerekçe kayda geçer, haftalık raporda
'kapora öncesi yapılan ön ödemeler' listesi çıkar. Denetimde ilk bakacağım liste budur."

**Moderatör:** Uzlaşma: kural `rules` tablosunda, varsayılan "uyar + gerekçe + Face ID ile istisna"; acenta isterse "blokla" seçebilir.
**Ana çatı 5 ve 8 ile uyumlu.**

**Müşteri kredi limiti.** **Selin Öztürk:** "Bankada ilk sorduğumuz şey müşterinin riski. Acenta da müşterisine kredi açıyor aslında:
etkinlik sonrası 30–60 gün vade bir kredidir. Sistem müşteri bazında 'risk' toplamalı: açık alacak + onaylanmış ama faturalanmamış iş +
gecikmiş tahsilat. Findeks raporu veya müşterinin bankası üzerinden istihbarat insanın işi, ama limit rakamı sistemde olmalı."

**Hakan Türkmen:** "Kamu kurumu ve üniversite müşterilerini ayrı işaretleyin: ödemeleri bütçe/ödenek ve hak ediş belgesine bağlıdır,
geç ödenir ama batmaz. Bir de kamuya hizmette KDV tevkifatı söz konusu olabilir; tahsil edilecek tutar faturadan düşük çıkar, nakit
planı bunu bilmeli `[Doğrulanmalı: organizasyon/toplantı hizmetlerinde belirlenmiş alıcılara tevkifat kapsamı ve oranı]`."

**Nermin Aksoy:** "Limit aşımında teklif bloklanmasın, yöneticiye uyarı gitsin. Büyük müşteriye 'limitiniz doldu' diyen acenta işi kaybeder;
ama yönetici bunu bilerek kabul etmeli."

**Tedarikçi ödeme planı ve pazarlık bağlantısı.** **Murat Kaya:** "Pazarlık taslağında 'ödeme kolaylığı' bir koz olarak var. O halde sistem
'ödeme planını %30/%70 yerine %20/%80'e çekersek nakit açığımız 12.000 EUR azalır' diyebilmeli. Bu, tedarikçi komitesiyle ortak bir konu."

**Avans–masraf ve kasa.** **Emre Yıldız:** "Saha sorumlusuna 20.000 TL iş avansı verdim. Sahada 14.300 TL harcadı, 11 fiş, 2 tanesi fişsiz
(bahşiş). Kalan 5.700 TL iade etmeli. Sistemde: avans verildi (kasa/banka çıkış), masraf fişleri (fotoğraf, AI okur, saha sorumlusu onaylar),
proje ve kalem bağlantısı, fişsiz harcama için gider pusulası/tutanak ihtiyacı, avans kapama."

**Aylin Korkmaz:** "Ürün sahibinin bir kararı var: 'saha finans göremez'. Bu karar avans modülüyle çatışmıyor, eğer saha yalnız *kendi avans
bakiyesini ve kendi girdiği fişleri* görürse. Proje kârlılığını, alış fiyatlarını görmez. Bunu ürün sahibine sormak lazım."

**Hakan Türkmen:** "Fişsiz bahşiş gider yazılamayabilir; KKEG (kanunen kabul edilmeyen gider) olarak işaretlensin `[Doğrulanmalı]`.
Ayrıca yurtdışı projelerde yabancı para kasası (EUR/USD nakit) ayrı tutulmalı."

---

### Tur 4 — Faturalama modeli, tarihler, iade/iptal, e-Fatura ve muhasebe programları

**Hakan Türkmen** faturalama modelini somutlaştırdı:

> **Örnek E — 3 model aynı projede.**
> (1) *Kendi nam ve hesabına*: Otel + salon + gala yemeği acenta tarafından satın alınıp müşteriye paket olarak satılıyor. Müşteri faturası tam
> satış bedeli üzerinden; alış faturaları acentanın gideri. Konaklama bedelinde konaklama vergisi kimde doğar, acentanın müşteriye faturasında
> nasıl gösterilir — sektörde farklı uygulamalar var `[Doğrulanmalı: konaklama vergisinin güncel oranı ve paket satışlarda acenta faturasında
> gösterimi]`.
> (2) *Aracılık*: Müşteri otelle doğrudan sözleşme yapıyor, fatura otelden müşteriye; acenta otelden komisyon alıyor ve otele **komisyon faturası**
> kesiyor (KDV'li). Acentanın geliri sadece komisyon.
> (3) *Masraf yansıtma*: Acenta müşteri adına vize harcı veya müze girişini ödüyor, faturası acenta adına; müşteriye **yansıtma faturası**
> kesiliyor. Yansıtma faturasında KDV uygulaması (genel kural: yansıtmalar da KDV'ye tabidir; bazı vergi/harç gibi kalemlerde istisna) `[Doğrulanmalı]`.

**Nermin Aksoy:** "Yönetim açısından üçünde de 'kâr' hesaplanabilir. Ama aracılık modelinde ciro şişmemeli — yoksa 2 milyon EUR'luk ciro
gösterip 60.000 EUR komisyon gelirine 'marj %3' diyen rapor çıkar. Marj, aracılık kalemlerinde 'komisyon geliri ÷ aracılık yapılan hacim'
olarak ayrı raporlanmalı."

**Serkan Bal:** "Logo'da bu üç model üç farklı fiş türüne gider: satış faturası, hizmet faturası (komisyon), masraf yansıtma. Kanonik fiş
modelinde 'faturalama modeli' alanı olursa adaptör doğru fiş türünü seçer."

**Yurtdışı müşteri.** **Hakan Türkmen:** "Yabancı bir şirketin Türkiye'deki teşvik gezisi: hizmet Türkiye'de tüketildiği için, konaklama ve
yerel hizmetlerde **hizmet ihracatı istisnası genellikle uygulanmaz** — çok sık yapılan bir hata. Buna karşılık yurtdışındaki tur operatörlerine
verilen belirli aracılık hizmetlerinde/komisyonlarda istisna değerlendirmesi yapılabilir `[Doğrulanmalı: KDVK 11/1-a ve KDV GUT'taki
turizm/aracılık düzenlemeleri]`. Sistem burada kural uygulamasın; 'yabancı müşteri — istisna kontrolü gerekir' bayrağı koysun, müşavire
sorulsun."

**Tarihler.** **Derya Çelik:** "Sistem her belgede şu alanları tutmalı: *belge (düzenleme) tarihi, hizmet/ifa başlangıç–bitiş, alındı/kayıt tarihi,
vade, ödeme tarihi*. Bir de VUK'taki 7 gün kuralı: hizmetin ifasından itibaren 7 gün içinde fatura düzenlenmeli `[Doğrulanmalı: VUK 231/5 ve
e-Fatura/e-Arşiv'deki güncel süre uygulamaları]`. Etkinlik 12 Haziran'da bitti, müşteri faturası taslağı 19 Haziran'a kadar muhasebeye
gitmediyse karar kutusunda uyarı."

**Emre Yıldız:** "Pratikte müşteri 'faturayı ay sonuna kes, bütçemiz o ay açılıyor' der. 7 günü aşan faturanın riski acentanın. Sistem en azından
uyarmalı ve gerekçeyi istemeli."

**e-Fatura ve entegratörler.** **Gülşen Arı:** "Gelen e-Faturalar acentanın özel entegratörüne düşer: Mikro'nun kendi e-Dönüşüm hizmeti,
Logo e-Dönüşüm, Uyumsoft, İzibiz, QNB eFinans, Sovos/Foriba, Turkcell e-Şirket… Sektöre satacaksanız tek entegratöre bağlanamazsınız.
En düşük ortak payda: UBL-TR XML. Acenta entegratör portalından XML indirir veya otomatik e-posta yönlendirmesi kurar; sistem okur."

**Derya Çelik:** "Ve ticari fatura senaryosunda 8 günlük itiraz/red süresi var `[Doğrulanmalı: TTK 21/2 ve e-Fatura senaryolarında güncel
uygulama]`. Otel yanlış fatura kesti, tutar sözleşmeden 1.800 EUR fazla; 8 günü kaçırırsak itiraz hakkı zayıflar, iade faturası pazarlığına döneriz.
Sistem tutar farkı alarmının yanına '7 gün 4 saat kaldı' sayacı koymalı."

**İade/iptal.** **Hakan Türkmen:** "Silinmez kayıt ilkesi muhasebeyle birebir örtüşüyor; belge silinmez, ters belge kesilir. Üç durum:
(a) *iade faturası* — alıcı kesmiş olduğu faturanın konusunu iade ediyor; hizmette daha çok fiyat farkı/indirim faturası; (b) *e-Arşiv/e-Fatura
iptali* — belirli süre ve koşullarla GİB/entegratör üzerinden `[Doğrulanmalı]`; (c) *iptal bedeli* — müşteri 40 kişiyi iptal etti, otel 'no-show/
cancellation fee' faturası kesiyor, biz müşteriye yansıtıyoruz. Cayma/iptal bedelinin KDV karşısındaki durumu tartışmalıdır; tazminat niteliğinde
olup olmadığına göre değişen özelgeler var `[Doğrulanmalı]`."

**Aylin Korkmaz:** "Sistem tarafında 'iptal' bir durum değişikliği ve yeni belge. Ana çatı 3 ile birebir uyumlu. Önemli olan proje kârlılığında
iptal bedelinin *gelir* mi *maliyet geri kazanımı* mı olduğu."

**Muhasebe programları — "Mikro yerine Logo kullanan acenta".** **Serkan Bal:** "Logo Tiger'da cari kod genelde '120.01.001' gibi hesap
planına bağlı değil, ayrı cari kart kodudur; muhasebe bağlantısı 'muhasebe kodu' alanıyla kurulur. Netsis'te cari kodu serbest metin, 15 karakter
gibi sınırlar olabilir `[Doğrulanmalı: sürüme göre]`. Logo'ya veri almak için üç yol var: (1) Excel/XML aktarım şablonları, (2) Logo Objects (masaüstü
COM, sunucuda çalışır), (3) yeni sürümlerde REST servisleri. Bulut SaaS'tan acentanın ofisindeki Logo sunucusuna doğrudan bağlanmak güvenlik ve
ağ açısından zor. Gerçekçi yol: XML/Excel şablon + ileride acenta tarafında küçük bir 'köprü ajanı'."

**Gülşen Arı:** "Mikro için de aynısı: Excel şablon bugün çalışıyor; Mikro'nun web servis/API seçenekleri sürüme göre değişir `[Doğrulanmalı]`."

**Tolga Er:** "Paraşüt'ün herkese açık REST API'si var; satış/alış faturası, cari, banka hareketi oluşturulabilir ve hatta e-Arşiv/e-Fatura resmileştirilebilir
`[Doğrulanmalı: güncel API kapsamı ve lisans]`. Luca ve Zirve'de müşavirler ağırlıklı Excel/XML içe aktarım kullanır. Bu yüzden önerim:
**1) genel Excel/CSV (her program), 2) Mikro ve Logo şablonları, 3) Paraşüt API, 4) Netsis/Luca/Zirve şablonları**."

**Serkan Bal:** "Ve kritik nokta: *çift aktarım*. Aynı fatura iki kez aktarılırsa Logo'da iki fiş olur. Her aktarılan kaydın kalıcı bir aktarım
kimliği olmalı, ikinci aktarım reddedilmeli ya da 'güncelleme' olarak işaretlenmeli."

**Hesap planı eşleme.** **Hakan Türkmen:** "Hesap kodlarını koda yazmayın. Her acentanın hesap planı farklı: kimi konaklama satışını
600.01, kimi 600.10 tutar. Masraf merkezi = proje kodu (PRJ-####) olsun; hem Logo hem Mikro'da proje/masraf merkezi alanı var."
**Moderatör:** Bu eşleme acenta ayarı/kural tablosunda; **ana çatı 8 ile uyumlu**.

---

### Tur 5 — İç kontrol, banka, ödeme güvenliği; ilk yakınsama

**Aylin Korkmaz** kontrol setini sundu:
1. **Görev ayrılığı:** ödeme talebini oluşturan kişi kendi talebini onaylayamaz (vekâlet dahil). Tek kişilik acentada (Emre'nin durumu)
   istisna: sahip hem girer hem onaylar ama sistem bunu 'tek imzalı ödeme' olarak raporlar.
2. **IBAN değişikliği:** tedarikçi banka bilgisi değişince (tedarikçi linkinden veya e-postayla) değişiklik *beklemede* olur; ikinci kanaldan
   (kayıtlı telefonla geri arama) doğrulama görevi açılır; Face ID ile onaylanır; değişiklikten sonraki ilk ödeme kartında 'YENİ IBAN' etiketi.
3. **Mükerrer ödeme:** aynı tedarikçi + aynı fatura no veya aynı tutar ±%1 + 30 gün içinde → karartılmış uyarı.
4. **Proforma ↔ kesin fatura** eşlemesi: proforma ödeme dayanağı olabilir, ama kesin fatura gelince proforma 'kapandı' olur; iki ayrı borç değil.
5. **Dönem kilidi:** muhasebeye aktarılmış veya acentanın 'dönemi kapat' dediği ayın belgeleri kilitlenir; veri değişirse eski belge 'stale'
   olmaz, *düzeltme belgesi* ihtiyacı doğar ve yeni dönemde ters/fark kaydı önerilir.

**Moderatör (ana çatı denetimi — dönem kilidi):** Ana çatı 4 "veri değişince bağlı belgeler stale olur ve yeniden üretilmeden gönderilemez" diyor.
Kilitli dönemde belge yeniden üretilmez, düzeltme belgesi üretilir. Bu **çelişki değil, ana çatı 4'ün bir genişlemesi**: eski belge yine 'stale'
işaretlenir (gönderilemez) ama 'yeniden üret' yerine 'düzeltme belgesi üret' yolu açılır. Ekleme niteliğinde; yine de ürün sahibine bilgi verilmeli.

**Selin Öztürk (banka):** "Üç pratik bilgi. *Birincisi*, toplu ödeme: bankalar toplu EFT/havale dosyası (Excel veya kendi formatında) alır; acenta
internet şubesine yükler, şube içinde ayrıca onaylar. Sistem onaylanmış ödemelerden bu dosyayı üretebilir — para hareketi yine bankada, insan
onayıyla olur. *İkincisi*, sanal POS: müşteriden kapora için kart ile tahsilat linki çok işe yarar; bazı bankalar döviz (EUR) sanal POS da sunar.
Ama POS komisyonu (%1,5–3), taksit maliyeti ve blokeli valör (paranın hesaba 1–30 gün sonra geçmesi) proje kârlılığına ve nakit akışına
yazılmalı. *Üçüncüsü*, teminat mektubu: kamu ve büyük kongre ihalelerinde acenta kesin teminat mektubu verir; mektubun komisyonu (yıllık %1–4
aralığında, bankaya ve riske göre) projenin maliyetidir ve mektubun iadesi takip edilmezse acenta yıllarca komisyon öder. Bir müşterim etkinlik
bittikten 2 yıl sonra hâlâ komisyon ödüyordu. Akreditif ise MICE'ta nadir; yurtdışı büyük tedarikçi ödemelerinde görülür."

**Moderatör (ana çatı denetimi — sanal POS linki):** Sanal POS ile tahsilat linkini müşteriye kim gönderir? AI otomatik gönderirse **ANA ÇATI
ÇELİŞKİSİ (madde 6 — dış mesaj insan onaylı ve insanın adresinden)**. Uyumlu yol: link, müşteri faturası/ödeme planı verisinden üretilir, insan
onaylayıp kendi adresinden gönderir; tahsilatı müşteri başlatır, sistem para hareketi yapmaz. Toplu banka ödeme dosyası için de: dosya yalnız Face ID
ile onaylanmış ödemelerden üretilir; AI dosya oluşturamaz veya bankaya iletemez.

**Murat Kaya:** "Banka API'si ile doğrudan ödeme emri göndermek (açık bankacılık ödeme emri hizmeti) ileride mümkün `[Doğrulanmalı: ödeme
hizmetleri mevzuatı, lisanslı aracı gereksinimi]`; ama bu sistemin ödeme kuruluşu gibi davranmasına yaklaşır. Ben P3 bile demem; 'hesap bilgisi'
(ekstre çekme) yeterli."

**Nermin Aksoy:** "Katılıyorum. Para çıkışı bankada kalsın. Sistemin görevi: doğru ödemeyi, doğru kişiye, doğru zamanda, doğru belgeyle
önermek ve izini tutmak."

**Fiili kur ve banka masrafları.** **Derya Çelik:** "Ekstre eşleştirmede EFT masrafı, SWIFT masrafı (yurtdışı ödemede OUR/SHA/BEN), BSMV ve
kur farkı satırları var. Bunlar şu an eşleşmeyen satır olarak kalıyorsa her gün birine 'bu ödeme nereye fatura edildi?' diye soruluyor —
yanlış. Banka masrafı satırları proje/genel gider olarak sınıflanmalı, fatura beklemez."

**Aylin Korkmaz:** "Dikkat: 'fatura beklemez' sınıfı kötüye kullanılabilir. Sınıflama kuralı bankanın masraf açıklama kalıplarıyla ve tutar
eşiğiyle sınırlı olsun; eşik üstü her şey fatura ister."

---

### Tur 6 — Ayrışmalar ve sektör genelinde uzlaşma

**Ayrışma 1 — Sistem fatura kessin mi?**
**Tolga Er:** "Küçük acenta için en büyük değer sistemin faturayı doğrudan kesmesi: proje kapandı, tek tuş, e-Arşiv/e-Fatura gitti. Paraşüt bunu
API ile yapıyor; biz de yapabiliriz."
**Hakan Türkmen:** "Ben karşıyım — en azından v0.5'te. Fatura kesmek vergi sorumluluğu, seri/sıra, entegratör sözleşmesi, mali mühür demek.
PRD kararı 'sistem taslak üretir, muhasebe keser' ve bu karar müşavirlerin ürünü önermesini kolaylaştırır; müşavir 'benim işimi elimden alıyor'
diye düşünmez."
**Nermin Aksoy:** "Büyük acentalar için kesinlikle taslak yeterli; küçükler için opsiyonel bir 'Paraşüt üzerinden kes' modülü P3 olabilir."
**Sonuç:** Açık ayrışma → ürün sahibine soru (S2). Komite çoğunluğu (7/10): v0.5'te kesim yok; P3'te entegratör/Paraşüt üzerinden *insan onaylı* opsiyonel kesim.

**Ayrışma 2 — Gerçekleşen kâr hangi kurla?**
Nermin + Selin + Murat: fiili kur ana gösterge. Hakan: VUK/TCMB ana gösterge, fiili yan bilgi. Aylin: ikisi yan yana, farkın açıklanması şart.
**Uzlaşma:** Ana gösterge (yönetici kartı) **fiili kur**; muhasebe/müşavir görünümü **TCMB belge kuru**; fark "banka kur marjı" satırı. Fiili kur yoksa
(ekstre henüz yüklenmemiş) TCMB kullanılır ve "tahmini" etiketi konur. Mevcut ürün kararı ("ödeme/tahsilat günü kuruyla") ile çelişmez, onu
somutlaştırır — yine de ürün sahibine teyit sorusu (S1).

**Ayrışma 3 — Finansman maliyeti kârlılığa girsin mi?**
Emre ve Murat: "Kapora gecikmesinin faiz maliyeti proje kârından düşülmeli, yoksa kârlı sanılan müşteri aslında zararlı." Hakan: "Muhasebede
bu proje maliyeti değil, finansman gideridir." Nermin: "Yönetim raporunda 'nakit ağırlıklı kâr' diye ikinci bir gösterge olsun, muhasebe kârına
karışmasın." **Uzlaşma:** P2, ayrı gösterge, faiz oranı kural tablosunda (yönetici girer). Ürün sahibine soru (S9).

**Ayrışma 4 — Müşteri kredi limiti aşımında blok mu uyarı mı?**
Selin ve Aylin "blok" (bankacı refleksi), Nermin ve Derya "uyarı + Face ID ile istisna". **Uzlaşma:** varsayılan uyarı + gerekçe; acenta kuralla blok
seçebilir (ana çatı 8). S6.

**Ayrışma 5 — TL fonksiyonel para birimi isteyen yurtiçi acentalar.**
**Tolga Er:** "Yalnız yurtiçi kurumsal toplantı yapan bir Ankara acentası tüm işini TL yapıyor. 'İç para birimi EUR' ona tuhaf gelecek; raporları TL
görmek ister." **Moderatör:** İç para biriminin değiştirilmesi **ANA ÇATI ÇELİŞKİSİ (madde 7)**. Uyumlu alternatif: iç hesap EUR kalır; her tutar kaynak
para birimiyle saklanır (zaten); kiracı bazında *görüntüleme/raporlama para birimi* TL seçilebilir, raporlar kaynak TL tutarlarla (çevrimsiz) ve
EUR karşılığıyla gösterilir. TL-TL işlemde kur riski sıfır görünür. Ürün sahibine soru (S7).

**Ayrışma 6 — Müşteriye ödeme hatırlatmaları.**
**Derya:** "Kapora gecikti; her gün elle hatırlatma yazmak hedef 1'e (takip kolaylığı) aykırı." **Moderatör:** Otomatik/onaysız gönderim
**ANA ÇATI ÇELİŞKİSİ (madde 6)**. Uyumlu yol: AI hatırlatma taslağını hazırlar; karar kutusunda "bugün gidecek 5 tahsilat hatırlatması" tek kartta
toplanır, insan tek dokunuşla (tek tek görülebilir) onaylar, mesajlar insanın adresinden çıkar. Not: brifinge göre müşteri teklifi otomasyona terfi
etmiyor; tahsilat hatırlatmasının "otomasyon terfisi" mekanizmasına girip girmeyeceği de ana çatı 6 kapsamında ürün sahibine sorulmalı (S5).

**Son tur uzlaşma — sektör geneli ilkeler (oybirliği):**
1. Para çıkışı ve tahsilat başlatma **her zaman bankada ve insanda**; sistem önerir, belgeler, izler.
2. Vergi parametreleri (KDV oranları, konaklama vergisi, tevkifat, BA/BS limiti, kur türü tercihleri) **yürürlük tarihli kural** olarak tabloda; kodda sabit yok.
   Sistem "vergi danışmanı" değildir; şüpheli durumda bayrak koyar, karar müşavirde.
3. Muhasebe entegrasyonu **kanonik fiş + ince adaptör + kiracı hesap planı eşlemesi**; Mikro özel çözümü bu modele taşınır (mevcut Excel çıktısı korunur — eklemeli).
4. Nakit, kur ve vergi modeli **teklif aşamasında** belirlenir; kârlılığın üç kolonu (teklif – sözleşme – gerçekleşen) aynı kalem kimliği üzerinden izlenir.
5. Küçük acenta (tek kişi finans) ile büyük DMC aynı ürünü kullanır; farklar kural/ayar ile çözülür (görev ayrılığı, kilit, blok/uyarı seçimleri).

---

## 3) Kararlar

> Format: **K#. Başlık** — gerekçe · hedef(ler) · öncelik · efor · v0.5?

**K1. Kalem düzeyinde faturalama/vergi modeli.** Her satış kalemi teklif aşamasında şu modellerden birini taşır: *kendi nam ve hesabına satış*,
*aracılık (komisyon)*, *masraf yansıtma*, *yalnız satış (katma değer kalemi)*. Kalemde KDV oranı, konaklama vergisi bayrağı, tevkifat kodu, istisna
kodu/“istisna kontrolü gerekir” bayrağı tutulur. Müşteri faturası taslağı ve muhasebe fişi modele göre üretilir; aracılık hacmi ciroya katılmaz, marj ayrı
raporlanır. Gerekçe: yanlış matrah en pahalı vergi hatası. Hedef 10, 2. **P1 · M · v0.5: Evet** (vergi oranları `[Doğrulanmalı]`, kural tablosunda).

**K2. Dört kur kavramı.** *Teklif/bütçe kuru* (beklenen kâr), *belge kuru* (belge tarihi TCMB, VUK), *fiili kur* (banka dekontu/ekstre),
*değerleme kuru* (dönem sonu; yalnız muhasebe ve açık pozisyon). Tüm tutarlar kaynak para birimi + kur türü + kur değeri + kur tarihiyle saklanır.
İç para birimi EUR (ana çatı 7) korunur. Hedef 10. **P1 · M · v0.5: Evet.**

**K3. Gerçekleşen kâr: fiili kur ana gösterge, TCMB yan gösterge.** Yönetici kartında fiili kurla gerçekleşen kâr; fark "banka kur marjı" satırı;
fiili kur yoksa TCMB + "tahmini" etiketi. Hedef 10. **P1 · S · v0.5: Evet** (ürün sahibi teyidiyle, S1).

**K4. Kur farkı motoru.** Belge para birimi ≠ ödeme/tahsilat para birimi olduğunda otomatik *“kur farkı faturası bekleniyor/kesilmeli”* kartı;
yönü (alacak/borç), tutarı ve KDV ayrıştırması (iç yüzde) taslaklanır; muhasebede kesilir. EUR-EUR kapanan işlemlerde yalnız kambiyo kârı/zararı
(muhasebe aktarımında). Hedef 10, 2. **P1 · M · v0.5: Evet** (`[Doğrulanmalı]` KDV hesap yöntemi).

**K5. Ödeme planı nesnesi (müşteri tahsilat planı + tedarikçi ödeme planı).** Sözleşmeden çıkarılır (AI ayıklar, insan onaylar): taksit, oran/tutar,
para birimi, vade, bağlı olay (opsiyon bitişi, T−n gün). Durumlar: planlandı / talep edildi / kısmi / tahsil-ödendi / gecikti. Gecikmede karar kartı.
Hedef 10, 1, 6. **P1 · M · v0.5: Evet.**

**K6. "Kapora önce" kuralı.** Tedarikçi ön ödeme talebi, bağlı müşteri kaporası tahsil edilmeden onaya gelirse kart kırmızı + proje net nakit
pozisyonu; varsayılan *uyar + gerekçe + Face ID istisna*, acenta *blok* seçebilir (`rules`). Haftalık raporda istisna listesi. Hedef 10, 6.
**P1 · S · v0.5: Evet.**

**K7. 13 haftalık kayan nakit akış tahmini.** Para birimi bazında (EUR/TL/USD); kaynaklar: ödeme planları, açık faturalar, onaylı ödeme talepleri,
elle girilen genel giderler (maaş, kira, vergi). v0.5'te temel görünüm; P2'de senaryo ("müşteri X 20 gün gecikirse", POS valörü, tevkifat etkisi).
Hedef 10, 6. **P1 (temel) · M · v0.5: Evet;** senaryolar P2.

**K8. Kur pozisyonu ve teklif kur politikası.** Teklifte zorunlu "kur politikası" alanı: *EUR teklif* / *TL + ödeme günü kuru maddesi* / *TL sabit + kur tamponu %*
(tampon `rules`'da). Maliyet para birimi ≠ teklif para birimi ise uyarı. Proje ve acenta düzeyinde açık pozisyon raporu; kur hareketiyle hedef marjın altına
düşen proje için uyarı kartı. Hedge kararı insanda. Hedef 10, 2. **P1 (politika alanı + uyarı) · M · v0.5: Evet;** pozisyon raporu P2.

**K9. Müşteri risk ve kredi limiti.** Risk = açık alacak + onaylı-faturalanmamış iş + gecikmiş tahsilat; limit yönetici girer; aşımda teklif/sözleşme
onay kartında uyarı (acenta blok seçebilir). Kamu/üniversite müşteri tipi bayrağı (geç ama güvenli ödeme, tevkifat). Hedef 10, 6. **P2 · M · v0.5: Hayır (v0.6).**

**K10. Kanonik muhasebe fişi + adaptörler.** Tek veri modeli (belge türü, faturalama modeli, cari, hesap eşlemesi, masraf merkezi = proje kodu, KDV/tevkifat,
döviz + TL karşılığı, kur türü, aktarım kimliği). Adaptör sırası: (1) Genel Excel/CSV, (2) Mikro (mevcut Excel korunur, modele taşınır), (3) Logo Tiger/Go
şablonu, (4) Paraşüt API, (5) Netsis, Luca, Zirve şablonları. Çift aktarım engeli; "aylık müşavir paketi" (Excel + PDF zip). Hedef 10, 6, 7. **P1 · L · v0.5: Evet (1–3);** 4–5 P2.

**K11. Kiracı bazında hesap planı ve cari kod eşlemesi.** Hesap kodları, fiş türleri, cari kod şablonu acenta ayarında; cari eşlemenin anahtarı VKN/TCKN;
muhasebedeki cari kodu tedarikçi/müşteri kartında saklanır; eşleşmeyen cari aktarımdan önce listelenir. Hedef 2, 7. **P1 · S · v0.5: Evet.**

**K12. Belge tarihleri.** Belge tarihi, hizmet/ifa başlangıç–bitiş, alındı/kayıt tarihi, vade, ödeme tarihi ayrı alanlar. Uyarılar: hizmetten sonra 7 gün
içinde müşteri faturası taslağı muhasebeye gitmedi `[Doğrulanmalı]`; KDV dönemi ile hizmet dönemi uyuşmazlığı. Proforma ↔ kesin fatura bağlantısı.
Hedef 2. **P1 · S · v0.5: Evet.**

**K13. Gelen e-Fatura: entegratör bağımsız UBL-TR + itiraz sayacı.** XML yükleme/e-posta yönlendirme (v0.5); entegratör API'leri (P2). Ticari fatura senaryosunda
itiraz süresi sayacı `[Doğrulanmalı]`; tutar farkı alarmıyla birlikte karar kartında. Hedef 2, 10. **P1 (sayaç + XML) · S · v0.5: Evet;** API P2.

**K14. İptal/iade/fiyat farkı = ters belge modeli.** İade faturası, fiyat farkı/indirim faturası, iptal bedeli (gelir mi maliyet geri kazanımı mı ayrımı),
e-Arşiv/e-Fatura iptal kaydı; hiçbir belge silinmez (ana çatı 3). İptal bedelinin KDV durumu `[Doğrulanmalı]`, kalemde bayrak. Hedef 10, 2. **P1 · M · v0.5: Evet.**

**K15. Komisyon mutabakatı genişletmesi.** Beklenen komisyon sözleşmeden/teklif kaleminden; komisyon faturası taslağı; tahsil takibi; yurtdışı tur
operatörü/aracılık istisna bayrağı `[Doğrulanmalı]`. Hedef 10. **P2 · M · v0.5: Hayır.**

**K16. Ödeme güvenliği paketi.** (a) Görev ayrılığı: talep eden kendi talebini onaylayamaz (tek kişilik acentada "tek imzalı" raporlanır);
(b) IBAN değişikliği: beklemede + ikinci kanal doğrulama görevi + Face ID + ilk ödemede "YENİ IBAN" etiketi; (c) mükerrer ödeme kontrolü;
(d) toplu banka ödeme dosyası yalnız Face ID ile onaylı ödemelerden. Hedef 2, 6. **P1 · M · v0.5: Evet.**

**K17. Dönem kilidi ve düzeltme belgesi.** Muhasebeye aktarılmış/kapatılmış dönem belgeleri kilitlenir; veri değişirse eski belge stale (gönderilemez),
yol "yeniden üret" değil "düzeltme belgesi üret". Hedef 2, 6. **P1 · S · v0.5: Evet** (ana çatı 4'ün genişlemesi — bilgi notu, bkz. §5).

**K18. Banka ekstresi genişletmesi.** MT940, CAMT.053 ve banka bazlı Excel şablonları (kiracı/banka eşleme ayarı); fiili kurun ekstreden okunması;
banka masrafı/BSMV/SWIFT masrafı satırlarının eşik altı kural bazlı sınıflanması (eşik üstü fatura ister). Hedef 10, 2. **P1 · M · v0.5: Evet** (MT940 + Excel); CAMT P2.

**K19. Avans–masraf ve kasa.** Personel iş avansı (verildi/harcandı/iade/kapandı), masraf fişi fotoğrafı (AI okur, insan onaylar), proje/kalem bağlantısı,
fişsiz harcama tutanağı + KKEG bayrağı `[Doğrulanmalı]`, TL ve döviz kasa defteri, ayrılan personelde açık avans kapanış engeli (offboarding kontrolü).
Saha yalnız kendi avansını görür. Hedef 7, 10, 6. **P2 · M · v0.5: Hayır** (ürün sahibi S4 cevabına bağlı; cevap olumluysa v0.6).

**K20. Kârlılık raporu: üç kolon + sapma nedenleri.** Teklif – sözleşme – gerçekleşen, aynı kalem kimliğiyle; sapma kategorileri: kur, saha ekstrası,
iptal/no-show, tedarikçi fatura farkı, banka/POS masrafı, finansman (P2), yansıtılamayan fark. Hedef 10, 7. **P1 · S · v0.5: Evet.**

**K21. Vergi parametreleri yürürlük tarihli kural.** KDV oranları, konaklama vergisi oranı, tevkifat oran/kodları, BA/BS limiti, fatura süresi gibi
parametreler `rules` içinde yürürlük başlangıç/bitiş tarihli; geçmiş belge eski oranla hesaplanır; AI değiştiremez (ana çatı 6, 8). Hedef 2. **P1 · S · v0.5: Evet.**

**K22. Finansal kapanış ayrı durum.** Operasyonel kapanıştan ayrı "finansal kapanış": tüm ödeme planları kapandı, kur farkı faturaları kesildi, komisyonlar
mutabık, açık avans yok, muhasebeye aktarıldı. 30 gün kuralına ek olarak 60/90 gün uyarı. Hedef 10, 6. **P2 · S · v0.5: Hayır** (kontrol listesine madde eklemek v0.5'te yapılabilir).

**K23. Teminat mektubu takibi.** Mektup türü, banka, tutar, vade, komisyon oranı (projeye maliyet), iade hatırlatması. Hedef 10. **P3 · S · v0.5: Hayır.**

**K24. Sanal POS tahsilat linki.** Ödeme planından üretilir, insan onaylar ve kendi adresinden gönderir; POS komisyonu ve valör nakit akışa/kârlılığa yazılır.
Hedef 3, 10. **P3 · M · v0.5: Hayır** (banka/POS sağlayıcı sözleşmesi gerektirir).

**K25. Finansman maliyeti göstergesi ("nakit ağırlıklı kâr").** Proje bazında acentanın taşıdığı negatif nakit × gün × faiz (oran `rules`'da); muhasebe kârına
karışmaz. Hedef 10. **P2 · S · v0.5: Hayır** (S9).

**K26. Müşteri faturası kesimi.** v0.5'te PRD kararı korunur: sistem taslak üretir, muhasebe keser. P3'te opsiyonel, insan onaylı entegratör/Paraşüt üzerinden
kesim modülü (S2). **P3 · L · v0.5: Hayır.**

---

## 4) Ürün sahibine sorular

**S1 — Gerçekleşen kârın ana kuru.** (a) TCMB ödeme/tahsilat günü kuru (bugünkü uygulama); (b) fiili banka kuru (ekstreden), TCMB yan gösterge;
(c) yalnız fiili. **Öneri: (b).** Mevcut kararınızın ("ödeme/tahsilat günü kuruyla") somutlaştırılmasıdır; fark "banka kur marjı" olarak görünür.

**S2 — Sistem müşteri faturasını kessin mi?** (a) Hayır, hep taslak (PRD v0.4); (b) P3'te opsiyonel, insan onaylı, entegratör/Paraşüt üzerinden;
(c) v0.5'te kesim. **Öneri: (b).** Komite 7/10 (a)+(b) yönünde; müşavir kanalı açısından v0.5'te kesim önerilmez.

**S3 — "Kapora önce" kuralının varsayılanı.** (a) Yalnız bilgi; (b) uyarı + gerekçe + Face ID ile istisna; (c) blok. **Öneri: (b)**, acenta (c)'yi seçebilir.

**S4 — Saha avans/masraf ile "saha finans göremez" kararı.** (a) Saha hiçbir finans verisi görmez, masrafı ofis girer; (b) saha yalnız kendi avans bakiyesini ve
kendi fişlerini görür, proje kârlılığı/alış fiyatı görmez; (c) saha sorumlusuna proje bütçe kalanını da göster. **Öneri: (b).**

**S5 — Müşteri tahsilat hatırlatmaları.** (a) Her mesaj tek tek insan onayı (mevcut); (b) günlük toplu kart, insan tek dokunuşla onaylar, insanın adresinden gider;
(c) otomasyon terfisiyle onaysız gönderim — **ANA ÇATI ÇELİŞKİSİ**. **Öneri: (b).** Ayrıca tahsilat hatırlatmasının, müşteri teklifi gibi "otomasyona terfi etmez"
listesine alınmasını öneririz.

**S6 — Müşteri kredi limiti aşımı.** (a) Uyarı; (b) uyarı + gerekçe + Face ID; (c) blok. **Öneri: (b)** varsayılan, acenta (c)'yi seçebilir.

**S7 — TL ağırlıklı yurtiçi acentalar.** (a) Sadece EUR görünüm; (b) iç EUR korunur, kiracı bazında TL raporlama/görüntüleme para birimi; (c) iç para birimini
kiracıya göre seçtir — **ANA ÇATI ÇELİŞKİSİ (madde 7)**. **Öneri: (b).**

**S8 — Muhasebe adaptör sırası (SaaS satışı için).** (a) Mikro → Logo → Paraşüt → Netsis → Luca/Zirve; (b) Genel Excel önce, sonra Mikro/Logo, sonra Paraşüt API;
(c) önce Paraşüt API (küçük acentalar). **Öneri: (b).** Genel Excel/CSV her programa ve her müşavire kapı açar.

**S9 — Finansman maliyeti kârlılıkta görünsün mü?** (a) Hayır; (b) ayrı "nakit ağırlıklı kâr" göstergesi, muhasebe kârına karışmaz; (c) proje kârından düşülsün.
**Öneri: (b).**

**S10 — Faturalama modeli seçimi kimde?** (a) Proje sahibi teklifte seçer; (b) sistem tedarikçi/sözleşme tipinden önerir, finans/yönetici onaylar;
(c) yalnız finans. **Öneri: (b);** model değişikliği teklif sonrasında olursa bağlı belgeler stale olur (ana çatı 4).

**S11 — Dönem kilidi.** Kilitli dönemde veri değişince "yeniden üret" yerine "düzeltme belgesi" yolunun açılmasını onaylıyor musunuz? (ana çatı 4 genişlemesi, §5)
**Öneri: Evet.**

---

## 5) Ana çatı çelişkileri

| # | Öneri (tartışmada geçen) | İhlal edilen madde | Durum / uyumlu alternatif |
|---|--------------------------|--------------------|---------------------------|
| Ç1 | Kur eşiği aşılınca sistemin otomatik forward/döviz alım talimatı vermesi | 6 (AI para hareketi yasak), 5 (Face ID) | **Reddedildi.** Sistem açık pozisyon + eşik uyarı kartı üretir; hedge kararı ve talimat insanda, bankanın kanalında. |
| Ç2 | Onaylı ödemelerin banka API'siyle sistemden doğrudan gönderilmesi | 6, 5 | **Ertelendi/önerilmez.** Sistem yalnız Face ID onaylı ödemelerden toplu ödeme *dosyası* üretir; yükleme ve banka içi onay insanda. AI dosya üretemez. |
| Ç3 | Kapora/bakiye hatırlatmalarının müşteriye otomatik, onaysız gitmesi | 6 (dış mesaj insan onaylı, insanın adresinden) | Toplu kart + insan tek dokunuş onayı + insanın adresi (S5). |
| Ç4 | Sanal POS ödeme linkinin AI tarafından gönderilmesi | 6 | Link veriden üretilir, insan onaylayıp gönderir; tahsilatı müşteri başlatır. |
| Ç5 | Kiracıya göre iç para biriminin TL seçilebilmesi | 7 (iç para birimi EUR) | İç EUR korunur; TL raporlama/görüntüleme para birimi + kaynak tutar saklama (S7). |
| Ç6 | Hatalı faturanın/eşleşmenin "silinip yeniden girilmesi" (sahada yaygın alışkanlık) | 3 (silinmez kayıt) | Ters belge/iptal durumu + yeni belge (K14). |
| Ç7 | Hesap kodları, KDV/konaklama vergisi oranları, tampon ve eşiklerin koda yazılması | 8 (kurallar tabloda) | Kiracı ayarı + yürürlük tarihli `rules` (K11, K21). |
| Ç8 | Masraf fişlerinde/e-Arşivde misafir adı-TCKN'nin AI ile okunup modele gönderilmesi (bireysel misafir faturaları) | 9 (KVKK — misafir verisi modele gitmez) | OCR/ayıklama misafir PII alanlarını maskeleyerek; misafir kimlik alanları yalnız şifreli depoda, insan girer/eşler. |
| Bilgi | Dönem kilidinde "yeniden üret" yerine "düzeltme belgesi" | 4'ün **genişlemesi** (ihlal değil) | Eski belge yine stale ve gönderilemez; yalnız iyileştirme yolu farklı. Ürün sahibinin onayına sunuldu (S11). |
| Bilgi | v0.5'te sistemden fatura kesimi | Ana çatı değil, **PRD v0.4 kararı** | Değiştirilmesi ürün sahibi kararı (S2). |

---

## 6) Diğer komitelere sorular / bağımlılıklar

- **Hukuk/Sözleşme komitesi:** Sözleşme şablonunda zorunlu finans maddeleri: ödeme planı (kapora %, vadeler, bağlı olaylar), kur maddesi (hangi kur, hangi gün,
  hangi banka/TCMB), iptal/no-show bedelleri ve niteliği (tazminat mı hizmet bedeli mi — KDV etkisi `[Doğrulanmalı]`), tevkifat ve kamu müşteri koşulları, temerrüt faizi.
  K5 ödeme planı ayıklaması bu maddelerin yapılandırılmış olmasına bağlı.
- **Tedarikçi/Satınalma komitesi:** Pazarlıkta "ödeme kolaylığı" kozunun nakit etkisinin (K7) taslağa girmesi; tedarikçi IBAN doğrulama sürecinin (K16) tedarikçi linkinde
  nasıl işleyeceği; yıllık kontrat fiyatlarında para birimi ve kur maddesi; proforma/kesin fatura alışkanlıkları; komisyon oranlarının kontrata yazılması (K15).
- **Operasyon/Saha komitesi:** Saha avans ve kasa akışı (K19, S4); saha ekstralarında nakit ödemenin belge disiplini; transfer/rehber gibi sahada nakit ödenen hizmetler.
- **Uçak bileti / ulaşım komitesi (modül yok):** BSP haftalık ödeme takvimi, ADM/ACM, bilet iade/iptal belgeleri ve komisyon/servis ücreti faturalaması nakit akışa (K7)
  ve faturalama modeline (K1) girmeli; bilet bedelinin aracılık mı kendi satış mı olduğu `[Doğrulanmalı]`.
- **Teknik/Güvenlik komitesi:** Face ID step-up'ın toplu ödeme dosyası, IBAN değişikliği, kur politikası istisnası ve dönem kilidi açma işlemlerine genişletilmesi;
  muhasebe adaptörlerinde çift aktarım kimliği; ofisteki Logo/Mikro sunucusuna bulut erişimi için "köprü ajanı" güvenliği; banka ekstre dosyalarının şifreli saklanması.
- **KVKK komitesi:** Bireysel misafire kesilen e-Arşiv faturalarında TCKN/ad işleme (Ç8); masraf fişlerinde kişisel veri; VUK saklama süreleri (genelde 5 yıl `[Doğrulanmalı]`)
  ile KVKK silme/anonimleştirme yükümlülüğünün çatışması — finans belgelerinin saklama süresi kuralı.
- **Ürün/SaaS & onboarding komitesi:** Acenta kaydında "muhasebe programı + hesap planı + banka şablonu + e-Fatura entegratörü" sihirbazı (K10, K11, K18);
  "aylık müşavir paketi"nin satış argümanı olarak müşavir kanalı; ilk veri yükünde (18 ay) açık alacak/borç ve ödeme planlarının taşınması.
- **AI/Otomasyon komitesi:** Ödeme planı ve kur maddesi ayıklamanın güven puanı eşiği; tahsilat hatırlatmasının otomasyon terfisi dışında tutulması (S5);
  AI'ın vergi kodu *önerisi* yapabileceği, *karar* veremeyeceği ilkesi (K1, K21).
- **Raporlama/Yönetim komitesi:** Yönetici telefon kartında tek rakam ilkesi (fiili kurla gerçekleşen kâr), nakit akış özeti ve "bu hafta kasadan çıkacak/girecek" kartı;
  ekip performansında kârlılık %'nin hangi kurla ve finansman maliyetli mi hesaplanacağı (S1, S9).
