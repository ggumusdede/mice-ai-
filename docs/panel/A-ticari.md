# Komite A — TİCARİ (satış, pazarlama, müşteri, gelir)

Konu: MICE AI Operations OS (PRD v0.4 uygulaması) — ticari açıdan değerlendirme ve v0.5 önerileri
Kaynak: BRIEF.md (zorunlu), PRD v0.4 §7 Adım 3–4, §9, §12–14 (ilgili bölümler)
Not: Kişiler kurgusaldır; anekdotlar sektördeki tipik durumları temsil eder.

---

## 1) Katılımcılar

| Kod | Kişi | Rol | Önceliği / önyargısı |
|---|---|---|---|
| SD | **Nesrin Aydemir** | Satış Direktörü (22 yıl; 8 yıl 5* otel grup satışı, 14 yıl DMC) | Kazanma oranı, hız, ekibin sistemi gerçekten kullanması. "Ekip kullanmazsa en iyi yazılım çöptür." |
| KS | **Murat Kılıç** | Kıdemli kurumsal satış (15 yıl; ilaç, otomotiv, banka hesapları) | İlişki her şeydir; müşterisini kişisel WhatsApp'tan yönetir. Kontrol mekanizmalarına şüpheyle bakar. |
| YS | **Ece Yalçın** | Yeni satış personeli (1,5 yıl) | Bilgiye erişim, örnek teklifler, "neyi neden yaptığımızı" öğrenmek; son dakika RFP'lerinde boğuluyor. |
| PD | **Selim Erkan** | Pazarlama Direktörü | SaaS satılabilirliği, marka, referans portföy, segment. |
| PP | **Deniz Akın** | Pazarlama personeli (dijital/içerik) | Vaka çalışmaları, fotoğraf/video arşivi, e-bülten, İYS uyumu. |
| GM | **Burak Tunç** | Gelir Müdürü (eski otel revenue manager; OTA, toptancı, rate shopping araçlarında uzman) | Dinamik fiyat, sezon, kontrat fiyatı, kanal paritesi; "satış marjı hediye ediyor". |
| CS | **Aylin Özgür** | Müşteri Başarı / CRM uzmanı | Müşteri yaşam döngüsü, tekrar eden etkinlikler, NPS, hesap devri. |
| DS | **Dr. Zeynep Karaca** | DIŞ SES — çok uluslu bir ilaç şirketinin Türkiye Satın Alma ve Etkinlik Müdürü | Şeffaf fiyat, uyum (compliance), bütçe merkezi, yanıt süresi SLA'sı, tek muhatap. |

Moderatör: komite sekreteri (tutanak).

---

## 2) Tartışma tutanağı

### TUR 1 — Her üye, ürünü 10 hedefe göre kendi rolünden değerlendiriyor

**Nesrin (SD):** "Adım 0'daki talep ayıklama ve PRJ kodu beni ikna etti. Bugün bizde bir talebin teklife dönmesi ortalama 4–5 iş günü; PRD hedefi ≤2 iş günü. RFQ'nun 3–5 tedarikçiye tek tıkla gitmesi ve 24 saat hatırlatma bunu yapar. Ama üç eksik görüyorum: (1) **Talepten önceki dünya yok.** Satış, RFP gelmeden başlar: müşteri ziyareti, 'seneye Mart'ta lansman yapacağız' sohbeti. Bunlar sistemde yoksa satışçının kafasında kalır; hedef 7 ölür. (2) **Kazanma/kaybetme analizi** kayıp nedeni zorunlu olduğu için başlıyor ama bunu satış kararına çeviren ekran yok. (3) **Ekip kullanmazsa** her şey boşa. Benim ekibim Excel'e bile proje girmiyor; sistemi 'ek iş' olarak görürse bitti."

**Murat (KS):** "Açık konuşayım: 15 yıldır Ayşe Hanım'la (bir ilaç firmasının etkinlik sorumlusu) WhatsApp'tan konuşuyorum. Gece 11'de 'Murat Bey, yarın 40 kişi daha gelebilir mi?' diye yazar. Bunu bir sisteme 'ilet' tuşuyla taşımam. Kontrolün sisteme bağlanması (hedef 6) patron için güzel; benim için 'senin yerine başkasını koyalım' demek. Bir şey daha: otomatik marj blokajı. Geçen yıl bir otomotiv müşterisini %6 marjla aldım, sonra aynı müşteriden üç yılda 11 proje çıktı. Sistem o ilk teklifi bloklasaydı o müşteri yoktu."

**Ece (YS):** "Ben tam tersini söyleyeceğim. Geçen ay Cuma 17:10'da 280 kişilik bir RFP geldi, son teslim Salı 12:00. Murat Bey izindeydi, müşteriyle geçmiş yazışmalar onun telefonundaydı. Geçen yıl aynı müşteriye hangi oteli, kaça verdiğimizi bulmak 3 saatimi aldı. Bu sistemde 'Bu projeye sor' ve fiyat geçmişi olsaydı 20 dakika. Benim için en değerli şey: **geçmiş teklifler, kazanan/kaybeden versiyonlar ve neden.** Eksik: İngilizce teklif şablonu. Uluslararası kongrelerde teklifi İngilizce istiyorlar, ben çeviriyle boğuşuyorum."

**Selim (PD):** "SaaS gözüyle bakıyorum. Ürünün satış hikâyesi güçlü: 'Talepten kapanışa tek doğru kaynak, AI asistan ama karar insanda.' Ancak bugünkü hâliyle bir **operasyon ürünü**; acenta sahibine satılır, satış ekibine değil. Pazarda rakipler (uluslararası etkinlik yönetim yazılımları, kayıt platformları) önce CRM ve kayıt modülüyle girer. Bizde CRM/pipeline 'Faz 3'. Bence butik acentalar için bu kabul edilebilir, büyük DMC ve kongre organizatörü (PCO) için katılımcı kayıt olmadan satış zor. Pazarlama tarafında: kapanıştaki müşteri anketi var, NPS yok; vaka çalışması üretimi yok; segmentasyon yok."

**Deniz (PP):** "Benim gözümde kapanış adımı altın madeni: her projeden fotoğraf, katılımcı sayısı, anket puanı, program akışı çıkıyor. Bunu 'referans kartı'na dönüştürebiliriz. Ama dikkat: Türkiye'de ticari elektronik ileti için **İYS (İleti Yönetim Sistemi)** kaydı ve onay şart. Kampanya modülü yapılırsa İYS entegrasyonu olmadan yapmayalım. Bir de misafir fotoğrafları KVKK kapsamında — referans materyalinde misafir yüzü, rıza olmadan kullanılamaz."

**Burak (GM):** "Markup kademe tablosu (kanal avantajı → %5…%25) iyi bir başlangıç ama **statik**. Otel tarafından geliyorum; aynı otel Mayıs'ın 3. haftasında, büyük bir tıp kongresi şehre geldiğinde 2,1 kat fiyat verir. Kanal fiyatını manuel girmek de yanlış pozitif üretir: OTA'da gördüğün fiyat iadesiz, geç saatte bakılmış, mobil özel indirimli olabilir. PRD bunu söylüyor (koşullar birebir), ama kanıt yok: **ekran görüntüsü ve zaman damgası** şart. En büyük eksik: **kontrat fiyatı ve allotment.** Yıllık anlaşmalı fiyatımız olan 40 otel var; her talepte RFQ atmak hem tedarikçiyi yorar (hedef 4) hem de fiyat değişkenliğini artırır (hedef 8). Ayrıca satış marjı hediye ediyor; benim gördüğüm, son çeyrekte teklif edilen marjla gerçekleşen marj arasında 3,8 puan kayıp var — revizyonlarda ve saha ekstralarında eriyor."

**Aylin (CS):** "Hedef 5 ve 7 benim alanım. 'Güvenilir irtibat' müşteri için tek bir şey demek: **'Kime yazacağım ve o kişi yoksa kim?'** Sistem projenin sahibini biliyor ama müşteriye 'sorumlu + yedek + saha 7/24 hattı' kartı vermiyor. İkincisi: tekrar eden etkinlikler. Kurumsal müşterilerin %60'ı yılda bir aynı etkinliği yapar (bayi toplantısı, yıl sonu, lansman). Kayıtlı projeden '11 ay sonra tekrar' fırsatı otomatik açılmazsa rakip kapar. Üçüncüsü: hesap devri. Bir satışçı ayrıldığında devir notu, açık sözler (verilen ama yazılmamış vaatler), müşterinin hassasiyetleri yazılı değil."

**Zeynep (DS, alıcı):** "Ben müşteriyim, sizin iç kurgunuz beni ilgilendirmez; şunlar ilgilendirir: (1) **Yanıt süresi.** Ajansları puanlarken ilk yanıt 2 saati, teklif 48 saati geçerse puan kırıyoruz. (2) **Şeffaflık.** Biz çerçeve sözleşmede çoğu zaman **'açık kitap' (open book) + yönetim ücreti** istiyoruz: otelin size verdiği net fiyatı görmek istiyorum, üstüne sabit %8–12 yönetim ücreti. Sizin markup tablonuz benim için kara kutu. (3) **Uyum.** İlaç sektöründe sağlık meslek mensuplarına (HCP) sağlanan değer raporlanır; kişi başı harcama sınırı, 'lüks/rekreasyonel' mekân yasağı, refakatçi masrafının karşılanmaması gibi kurallarımız var [Doğrulanmalı: yürürlükteki TİTCK tanıtım yönetmeliği ve sektör etik kuralları]. Ajans bunu benim yerime kontrol ederse tercih sebebidir. (4) **Bütçe merkezi.** Bir toplantıyı üç ürün ekibi paylaşır; faturanın maliyet merkezine bölünmesini isterim. (5) Ve evet, kabul ediyorum: biz pax'ı 6 kez değiştiririz. Ama her değişikliğin **bana maliyetini** anında görmek istiyorum."

### TUR 2 — Karşı argümanlar: ilişki, WhatsApp, kontrol

**Nesrin → Murat:** "Murat, Ayşe Hanım seni 15 yıldır seviyor, doğru. Ama 2023'te sen 3 hafta hastanedeyken o müşterinin iki projesini neredeyse kaybettik çünkü opsiyon tarihleri senin telefonundaydı. Hedef 6 seni değiştirmek değil, seni **sigortalamak**."

**Murat:** "Tamam, ama müşteriye 'artık şu numaraya yazın' diyemem. Kurumsal müşteri numara değiştirmeyi sevmez; ayrıca Ayşe Hanım'a kurumsal bir bot gibi görünmek istemem."

**Aylin:** "Kimse numara değiştirmeyi istemiyor. İki katmanlı öneri: (a) **Acentanın WhatsApp Business numarası** (Cloud API) üzerinden kişiye atanmış konuşma: müşteri yazdığında mesaj projeye bağlanır, yanıt Murat'ın adıyla ve onayıyla gider. Yeni müşteriler için varsayılan bu. (b) Mevcut kişisel ilişkiler için **'Sisteme ilet'** kısayolu ve **sohbet dışa aktarımı içe alma** (WhatsApp'ın 'sohbeti dışa aktar' dosyası). AI bunları ayıklar, projeye bağlar, karar/söz/rakam içeren mesajları işaretler. Murat'tan istediğimiz tek şey: **rakam, tarih, pax, onay içeren her mesajı iletmek.**"

**Murat:** "Gece 11'deki 'olur mu?' sorusuna 'olur' dediysem?"

**Burak:** "İşte asıl tehlike bu. 'Olur' dediğin 40 kişi, otelin allotment'ında yoksa ve kesinti (cut-off) tarihi geçtiyse, rack rate'ten ödersin. Geçen yıl Antalya'da bu yüzden bir projede 6.200 EUR marj eridi. Sözlü 'olur' sistemde bir **'söz verildi' kaydı** olmalı; değişiklik akışını tetiklemeli."

**Zeynep (alıcı):** "Alıcı olarak söyleyeyim: Murat Bey'in gece 'olur' demesini seviyorum ama **sonra yazılı teyit** gelmezse ve fatura farklı çıkarsa, ilişkiyi değil satın alma prosedürünü dinlerim. Bizim denetçiler WhatsApp ekran görüntüsünü kabul etmez. Revize teklif veya değişiklik onayı bir linkle gelirse ben de rahat ederim."

**Ece:** "Benim için ayrıca bir şey: Murat Bey'in WhatsApp'taki 15 yıllık bilgisi sistemde olsaydı ben onun yokluğunda iş yapabilirdim. Müşteri hassasiyetleri: 'Ayşe Hanım vejetaryen menüyü ilk sayfada görmek ister', 'Genel müdür koridor odasını sevmez'... Bunlar müşteri kartında **'tercih notu'** olmalı."

**Zeynep:** "Dikkat: Genel müdürümüzle ilgili not kişisel veri. Bunu bir yapay zekâ modeline gönderiyorsanız rahatsız olurum."

**Aylin:** "Ana çatı 9 bunu söylüyor: misafir verisi modele gönderilmez. Ancak müşteri tarafı irtibat kişisi (Ayşe Hanım) misafir değil, ticari muhatap. Önerim: müşteri kartında **iki ayrı not türü**: 'kurumsal tercih' (modele gidebilir: 'vejetaryen seçenek ilk sayfada') ve 'kişiye ait hassas not' (şifreli, modele gitmez, yalnız yetkiliye görünür). [Doğrulanmalı: KVKK açısından ticari muhatap verisinin işleme dayanağı.]"

**Murat → Nesrin (performans raporu):** "Ekip performans raporu 'kazanma %, kârlılık %' diyor. Ben ilaç müşterisinde %30 kazanırım çünkü 3 ajans arasında pitch vardır; Ece küçük KOBİ işlerinde %70 kazanır. Bu tablo duvara asılırsa ben kötü görünürüm."

**Nesrin:** "Haklı itiraz. Rapor segment ve proje büyüklüğüne göre normalize edilmeli: kazanma oranı **ciro ağırlıklı** ve **segment içinde** gösterilmeli. Ve kişiler birbirinin sıralamasını görmemeli; ben herkesi, herkes kendini görmeli."

**Aylin:** "Benimsemenin (adoption) asıl anahtarı şu: satışçı sisteme bilgi girerse **kendi primini** doğru ve şeffaf görmeli. Bugün primler Excel'de, yıl sonunda kavga çıkıyor. Prim gerçekleşen kâr üzerinden (zaten TL ve EUR olarak hesaplanıyor) hesaplanıp satışçının kendi ekranında görünürse, Murat dahil herkes her rakamı sisteme girer."

**Murat:** "İşte buna evet derim. Primimi gerçek zamanlı görüyorsam, mesajı iletmeye de razıyım."

*Kayda geçen anlaşmazlık A1:* Murat kişisel WhatsApp'ın yasaklanmasına karşı; Nesrin yeni müşteriler için zorunlu kurumsal kanal istiyor. → Tur 5'te uzlaşı.

### TUR 3 — Gelir Müdürü vs Satış: marj, fiyat, sezon, şeffaflık

**Burak:** "Somut veriyle başlayayım. Bir otelden 100 EUR net aldık, OTA'da aynı koşulda 118 EUR. Avantaj %15,3 → tablo %20 markup → 120 EUR satış, marj %16,7. Ama şehirde aynı hafta büyük kongre var, alternatif yok, müşteri fiyata duyarsız. Burada %25 markup bırakılabilirdi. Tersi de var: Ocak'ta İstanbul'da her otel boş, müşteri 3 teklif topluyor; %20 markup bizi kaybettirir. Tablo **talep ve sezon** boyutu almalı."

**Nesrin:** "Burak, sen otel satışından geliyorsun; otelde fiyatı sistem belirler, müşteri kabul eder ya da etmez. Bizde müşteri yılda 6 proje veren ilişki. Ocak'ta %20 yerine %12 verip Mayıs'ta %25 almak satışçının işi. Kuralları ne kadar boyutlandırırsan satışçı o kadar 'sistem böyle dedi' diye düşünmeyi bırakır."

**Burak:** "Tam da bu yüzden öneri olarak istiyorum, zorunlu değil. Sistem 'önerilen markup: %22; gerekçe: sezon yüksek, kongre haftası, 3 yıllık ortalamanız bu müşteride %19' desin. Satışçı düşürmek isterse düşürsün, ama **hedef marjın altına inerse karar kutusuna** düşsün — bu zaten var."

**Murat:** "Benim %6 marjlı otomotiv projem ne olacak?"

**Nesrin:** "O zaten var olan kuralla çözülür: hedef marj altı bloklanır, yönetici gerekçeyle açar. Senin argümanın 'yatırım teklifi' — o zaman gerekçe kodu 'stratejik müşteri kazanımı' olur ve 12 ay sonra sistem bize 'bu yatırım geri döndü mü?' diye sorar. **Müşteri yaşam boyu kârlılığı** olmadan yatırım teklifi kumardır."

**Burak:** "İkincisi: 3,8 puanlık marj erimesi. Bunun %60'ı revizyonlarda: müşteri pax'ı düşürüyor, otel fiyatı kişi başı sabit kalıyor ama salon, AV, rehber gibi sabit maliyetler bölünecek kişi azalıyor. Satışçı revize teklifte aynı kişi başı fiyatı veriyor. Sistem revizyonda **sabit/değişken maliyet ayrımı** yapıp 'bu revizyonla marj %18'den %11'e düşüyor' demeli."

**Zeynep (alıcı):** "Ve bana söylemeli. Ben 6 kez pax değiştiririm, çünkü kayıtlar bizim elimizde değil; hekimler son ana kadar teyit vermez. Ama her değişiklikte 'kişi başı fiyatınız 410 → 452 EUR oldu, nedeni sabit maliyetlerin 180 kişiye bölünmesi' görürsem itiraz etmem. Etmediğim şey sürpriz faturadır. Ve **kesinti tarihleri (attrition / cut-off)** baştan sözleşmede ve portalda görünmeli: 'X tarihine kadar %20 düşüş ücretsiz, sonra oda başı ceza'."

**Ece:** "Öneri: teklifte baştan **pax bandı fiyatlaması**: 150–180 kişi: 452 EUR, 181–220: 425, 221–260: 410. Müşteri bandın içinde oynadıkça revizyon bile gerekmez."

**Burak:** "Çok iyi, otellerin grup fiyat matrisi mantığı. Ama bant fiyatı her bandın kendi maliyet hesabından üretilmeli, satışçı uydurmamalı. Ana çatı 4 (belge veriden) ile tam uyumlu."

**Zeynep → herkes (şeffaflık):** "Şimdi esas konuya geleyim: açık kitap. Sizin sisteminizde otelin net fiyatı, kanal fiyatı, avantaj yüzdesi var. Bana neti ve yönetim ücretini gösterin."

**Burak:** "Avantaj yüzdesi ve kanal fiyatı **bizim pazarlık bilgimiz**; açık kitapta bile gösterilmez. Net fiyatı gösterebiliriz, ama o zaman otelin bize verdiği komisyon/override ne olacak? Bazı otel zincirleri yıllık hacim primi (override) verir."

**Zeynep:** "Bizim çerçeve sözleşmemiz der ki: tüm komisyon ve hacim primleri ya bize iade edilir ya da beyan edilir. Bu uluslararası satın almada standart [Doğrulanmalı: müşteri sözleşmesine göre değişir]."

**Nesrin:** "Demek ki ürün **iki fiyat modelini** desteklemeli: (1) Gömülü markup (bugünkü model; butik acentaların ve KOBİ müşterilerin %80'i). (2) Açık kitap + yönetim ücreti (büyük kurumsal ve ilaç). (3) Hibrit: konaklama açık kitap, acentanın kendi hizmetleri (yalnız satış kalemi) sabit fiyat. Bu müşteri bazında kural olmalı."

**Burak:** "Ve marj/markup ayrımı açık kitapta da korunur: yönetim ücreti %10 ise, bu 'maliyet üzerine %10' yani markup'tır; marj %9,1'dir. Satış ekibi bunu sürekli karıştırıyor; ekranda ikisi de yazmalı."

**Zeynep:** "Bir de bizim otel zincirleriyle **kendi kurumsal anlaşmamız** var. Ajans bizim kurumsal fiyatımızı kullanmalı. Ama siz 'tedarikçiye müşteri adı gizli' diyorsunuz; otel bizim adımızı bilmeden kurumsal fiyatımızı nasıl verecek?"

**Murat:** "Bu sahada her gün oluyor. Müşteri adı gizli kuralı, tedarikçinin müşteriye doğrudan gitmesini engellemek için konmuş. Ama ilaç müşterisinde müşterinin adı zaten bir kaldıraç."

**Nesrin:** "Bu, ürün sahibinin önceki kararıyla çelişiyor; mimari değil ama karar. Müşteri bazında 'müşteri adını tedarikçiye açabilir' istisnası ve yönetici onayı öneririz — ürün sahibine soralım."

*Kayda geçen anlaşmazlık A2:* Burak, markup önerisinin sezon/talep/müşteri boyutlu "öneri motoru" olmasını istiyor; Nesrin karmaşıklıktan korkuyor ve satışçının takdirini korumak istiyor. → Tur 5'te uzlaşı (öneri, zorunlu değil; varsayılan = mevcut tablo).

*Kayda geçen anlaşmazlık A3:* Zeynep kanal fiyatı/avantaj bilgisini de görmek istedi; Burak ve Nesrin reddetti. Komite: açık kitapta net + ücret görünür, kanal/avantaj/pazarlık notları hiçbir modelde müşteriye gitmez.

### TUR 4 — Hız, son dakika RFP, çok dilli kongre, pazarlama ve SaaS

**Ece:** "Cuma 17:10 RFP'sine dönelim. Mevcut akış: RFQ → 24 saat hatırlatma → 48 saat telefon görevi. Salı 12:00 teslimde bu takvim zaten işlemez. Bir **'acil teklif modu'** istiyorum: hatırlatma 4 saat, telefon görevi 8 saat, opsiyon kısa; ve kontrat fiyatı olan otellerde RFQ'suz anında fiyat."

**Burak:** "Kontrat fiyatı ve allotment olmadan acil mod yarım kalır. Kontratlı 40 otelin fiyatını sistem bilirse, 280 kişilik teklifin %70'i 30 dakikada çıkar; RFQ'yu yalnızca kontratsız kalemlere (özel mekân, gala) atarız."

**Nesrin:** "Bir de **'teklif verelim mi' (bid/no-bid)** kararı. Her RFP'ye koşmak hız hedefini öldürüyor. Son 18 ayın verisinden: 'bu müşteri tipinde, bu bütçe/pax oranında, bu kadar kısa sürede kazanma oranımız %12' bilgisini görürsem, ekibi o işe değil kazanabileceğimiz işe veririm."

**Zeynep (alıcı):** "Hız için bir şey daha: bana RFP'yi aldığınızı 2 saat içinde **teyit edin**. Teklif değil, sadece 'aldık, Salı 12'de göndereceğiz, sorularımız şunlar'. Bu tek mesaj ajans puanımızın %20'si."

**Aylin:** "AI bu teyit mesajını eksik bilgi sorularıyla birlikte zaten taslak olarak hazırlıyor (Adım 0). Sorun gece ve hafta sonu. Öneri: taslak hazır olunca satışçının telefonuna push; **tek dokunuşla onay**, kendi adresinden gider."

**Selim:** "Neden otomatik gitmesin? 'Talebiniz alındı' mesajında risk yok."

**Nesrin:** "Ana çatı 6: dışarıya giden her mesaj insan onaylı ve insanın adresinden. Otomatik alındı mesajı bunu deler. Ben kuralı doğru buluyorum: AI bir gün 'alındı, Salı teslim' yazar, biz o işe no-bid deriz, müşteri bekler."

**Selim:** "O zaman en azından ürün sahibine soralım: insanın önceden onayladığı, değişkensiz sabit bir 'alındı' şablonu, mesai dışında otomatik gidebilir mi? Rakip yazılımların hepsi bunu yapıyor."

*Kayda geçen anlaşmazlık A4 (bölünme):* Selim + Zeynep otomatik alındı teyidi istiyor; Nesrin + Aylin + Burak ana çatı 6'yı korumak istiyor. → ANA ÇATI ÇELİŞKİSİ olarak işaretlendi; uyumlu alternatif: tek dokunuş onay + "mesai dışı nöbetçi" (vekâlet) ataması. Ürün sahibine soru.

**Murat (çok dilli kongre):** "Geçen yıl 1.800 kişilik uluslararası bir tıp kongresinin konaklama ve sosyal programını aldık. Teklif İngilizce, sözleşme İngilizce, ödeme USD, katılımcıların bir kısmı kendi ödüyor, bir kısmı sponsorlu. Bizim sistem: iç para birimi EUR — sorun değil, ama müşteriye USD teklif, TL fatura, EUR raporlama nasıl olacak?"

**Burak:** "Ana çatı 7 iç para birimi EUR diyor; müşteriye **gösterim ve sözleşme para birimi** ayrı bir alan olabilir. Kritik olan: teklifte **kur sabitleme** (teklif tarihinde kilitli kur + geçerlilik) ve kur riski maddesi. Bunu satışçı unutursa 1.800 kişilik projede %3 kur hareketi tüm marjı yer."

**Ece:** "Ve dil: AI çeviri taslağı + insan onayı. Şablonlar TR/EN zorunlu, DE/RU/AR opsiyonel. Müşteri linki sayfası da müşterinin dilinde."

**Selim:** "Burada PCO dünyasına giriyoruz: katılımcı kaydı, yaka kartı, abstract — brifte 'yok' denmiş. Benim pazar okumam: butik ve kurumsal acentaya bugünkü ürün satılır; PCO'ya kayıt modülü olmadan satılmaz. Kayıt modülünü sıfırdan yazmak yerine piyasadaki kayıt platformlarıyla **entegrasyon** daha akıllıca."

**Deniz (pazarlama):** "Kapanış adımından **vaka çalışması taslağı**: proje özeti, pax, destinasyon, anket skoru, ekip notu; müşteri adı ve misafir görselleri ancak rızayla. AI taslak yazar, pazarlama onaylar, müşteriye 'referans olarak adınızı kullanabilir miyiz?' onay linki gider. Bu hem satış (Ece'nin örnek ihtiyacı) hem SaaS pazarlaması için."

**Zeynep:** "Biz ilaç şirketi olarak adımızın referans listesinde geçmesine neredeyse hiç izin vermeyiz. Anonim vaka ('Global ilaç firması, 320 HCP, Kapadokya') kabul."

**Selim (SaaS):** "SaaS satılabilirliği için üç şey: (1) **Hızlı değer:** ilk veri yükü (18 ay) büyük satış argümanı — 'ilk hafta kendi geçmiş fiyatlarınızı görün'. (2) **Paketleme:** Butik (2–5 kullanıcı, sade ekran, Mikro/Logo/Paraşüt aktarımı), Profesyonel (CRM + kontrat fiyatı), Kurumsal/DMC (çok marka, çok para birimi, açık kitap, uyum kuralları, SSO). (3) **Viral kanal:** tedarikçi link sayfaları binlerce otele gidiyor. Küçük bir 'bu RFQ ... ile gönderildi' imzası tedarikçi tarafında farkındalık yaratır; ama müşteri sayfaları tamamen acentanın markasıyla (white-label) olmalı."

**Burak:** "Tedarikçi sayfasındaki imza bazı acentaları rahatsız eder: 'otel benim hangi yazılımı kullandığımı bilmesin.' Acenta kapatabilmeli."

**Selim:** "Kabul — ayar, varsayılan kapalı değil açık; fiyatlandırma paketinde 'imzasız' üst pakette."

**Nesrin:** "Bence varsayılan kapalı olsun; acenta güvensizlik hissederse ilk haftada bırakır."

*Kayda geçen anlaşmazlık A5:* Tedarikçi sayfasında "powered by" imzası varsayılanı — Selim açık, Nesrin/Burak kapalı. → Tur 5'te: varsayılan kapalı, açana küçük indirim (ticari teşvik). Ürün sahibine bilgi.

**Selim (sektör karşılaştırması):** "SaaS'ın en güçlü satış argümanı 'sektör ortalamasına göre neredesiniz': ortalama yanıt süresi, kazanma oranı, otel fiyat endeksi. Tüm kiracıların verisinden anonim benchmark."

**Burak:** "Otel fiyat endeksi büyük değer, ama acentaların pazarlık verisi rakiplerinin hizmetine girer. Kimse fiyatını paylaşmaz."

**Teknik not (sekreterya):** Kiracılar arası veri birleştirme, ana çatı 2 (her kayıt tenant_id + FORCE RLS) ile doğrudan çelişir. → ANA ÇATI ÇELİŞKİSİ olarak işaretlendi.

### TUR 5 — Uzlaşma turu

**Moderatör:** Her anlaşmazlığı tek tek kapatıyoruz.

**A1 — WhatsApp:** 
- Murat: "Kişisel WhatsApp'ı bırakmam ama rakam/tarih/pax/onay içeren her mesajı ileteceğim; primim sistemden hesaplanacaksa."
- Nesrin: "Yeni müşteriler için acentanın WhatsApp Business numarası varsayılan; mevcut ilişkiler için 'ilet + dışa aktarım içe alma' ve **çeyreklik hesap sağlığı kontrolü**: projede sözleşmeye/teklife yansıyan ama sistemde kaynak mesajı olmayan değişiklikler raporlanır."
- Aylin: "Ve **hesap devri prosedürü**: çalışan ayrılırken AI, müşteri kartı + yazışma + açık sözlerden devir özeti taslağı çıkarır; yeni sorumlu ve müşteri ortak bir tanışma mesajı alır (insan onaylı)."
- **Uzlaşı:** Yasak yok; kurumsal kanal varsayılan; kişisel kanal için zorunlu "ilet" kuralı ve görünürlük raporu. Müşteri iletişim bilgisi şirkete aittir (İK politikası — yönetim komitesine).

**A2 — Markup öneri motoru:**
- Burak: "Sezon takvimi, şehir talep takvimi (büyük kongre/fuar haftaları), lead time ve müşteri geçmiş marjı → öneri."
- Nesrin: "Kabul, şartla: (1) varsayılan = bugünkü tablo; boyutlar acenta isterse açılır (butik acentayı boğmayalım), (2) öneri gerekçesiyle gösterilir, (3) satışçı hedef marjın üstünde serbest."
- **Uzlaşı:** Rules tablosuna isteğe bağlı boyutlar (sezon, segment, lead time); AI kanıtla önerir, yönetici kural olarak kabul eder (ana çatı 8 uyumlu).

**A3 — Şeffaflık:**
- **Uzlaşı:** Müşteri bazında fiyat modeli: gömülü / açık kitap + yönetim ücreti / hibrit. Açık kitapta müşteriye: net alış (tedarikçi belgesine bağlı), yönetim ücreti, beyan edilmiş komisyon/override. Asla: kanal fiyatı, avantaj %, pazarlık notları, diğer tedarikçi teklifleri.
- Zeynep: "Tedarikçi faturasının kopyasını da isterim." — Burak: "Açık kitap modelinde kabul; tedarikçi sözleşmemize 'faturanın müşteriye ibrazı' maddesi koymak gerek." → tedarik komitesine.

**A4 — Otomatik alındı mesajı:** Bölünme sürüyor. Komite çoğunluğu (5/8) ana çatıyı korumayı öneriyor; uyumlu alternatif: tek dokunuş onay + mesai dışı nöbetçi vekili + SLA sayacı (karar kutusunda "2 saat dolmak üzere" kartı). Ürün sahibine soru.

**A5 — Powered-by:** Varsayılan kapalı; açan acentaya abonelikte teşvik. Bilgi notu olarak ürün sahibine.

**Ek uzlaşı — CRM ne zaman?**
- Nesrin ve Aylin: "Faz 3'ü bekleyemeyiz; hafif fırsat kaydı şimdi."
- Burak: "Benim için kontrat fiyatı daha acil."
- Selim: "İkisi de SaaS için temel; ama efor farklı."
- **Uzlaşı:** v0.5'te **hafif fırsat (lead/opportunity) kaydı + yıllık tekrar fırsatı + hesap kartı** (S–M efor; mevcut proje modeline 'talep öncesi' durum eklenerek, eklemeli). Tam pazarlama kampanya modülü P3. Kontrat fiyatı P1 (tedarik komitesiyle ortak).

**Ek uzlaşı — Performans görünürlüğü:** Kişi kendi panosunu görür; yönetici herkesinkini; akran sıralaması varsayılan kapalı (kural); kazanma oranı segment içinde ve ciro ağırlıklı.

**Zeynep'in kapanış sözü:** "Bir alıcı olarak bu sistemi kullanan ajansı tercih etmem için üç şey yeter: 2 saatte teyit, her değişiklikte maliyet şeffaflığı ve tek bir portal linkinde güncel her belge + kime ulaşacağım. Uyum kurallarımı sizin sisteminiz kontrol ederse, çerçeve sözleşmede puanınız artar."

**Murat'ın kapanış sözü:** "Primimi görüyorsam ve sistem benim ilişkimi 'gözetlemek' yerine Ece'nin benim yokluğumda müşterimi düşürmemesini sağlıyorsa, varım."

### TUR 6 — Sektör geneli sağlama (butikten DMC'ye)

**Selim:** "Kararları üç profile karşı sınayalım: (a) 4 kişilik butik incentive acentası, (b) 40 kişilik kurumsal MICE acentası (bizim pilot), (c) 200 kişilik DMC/PCO."
- Butik: açık kitap, uyum kuralları, çok dilli şablon gizli/kapalı olmalı → **özellik bayrakları ve 'sade mod'**. Fırsat kaydı ve yıllık tekrar herkes için değerli.
- Kurumsal: hepsi.
- DMC/PCO: yurt dışı acentalardan gelen B2B talepler (müşteri bir başka acenta) — müşteri tipinde **'acenta (B2B)'** ve komisyonlu fiyat; çok para birimi; kayıt platformu entegrasyonu.
**Burak:** "DMC'de yurt dışı acentaya net fiyat + komisyon verilir; markup tablosu B2B'de farklıdır — yine kural tablosuyla segment boyutu çözer."
**Aylin:** "Tüm profillerde ortak: müşteri irtibat kartı ve portal."
**Sonuç:** Kararlar profil bazında bayraklanacak (aşağıda 'Sektör' sütunu yerine gerekçe içinde belirtildi).

---

## 3) Kararlar

> Biçim: **Gerekçe · Hedef(ler) · Öncelik · Efor · v0.5?** — Ana çatı uyumu her kararda kontrol edildi.

**K1. Müşteri irtibat kartı ve proje portalı (tek link)**
Her projede müşteriye görünen kart: sorumlu + yedek + saha 7/24 hattı (operasyon tarihlerinde), güncel tüm belgeler (teklif Rev.n, sözleşme, program, rooming durumu), açık onay bekleyenler, değişiklik geçmişi (müşteri tarafından yapılan değişiklikler ve maliyet etkisi). Mevcut giriş gerektirmeyen link altyapısının genişletilmesi; eski (stale) belgeler portalda "güncelleniyor" görünür.
Gerekçe: alıcının bir numaralı beklentisi; çalışan değişse de irtibat kesilmez. · Hedef: 5, 3, 7, 9 · **P1** · M · **Evet**
Ana çatı: uyumlu (4: belgeler veriden; 6: portaldan giden bildirim yine insan onaylı).

**K2. Hafif fırsat kaydı (talep öncesi) + yıllık tekrar fırsatı + hesap kartı**
Proje modeline eklemeli "fırsat" durumu (beklenen tarih, tahmini pax/bütçe, olasılık, kaynak: ziyaret/telefon/fuar). Kapanan projeden 9–11 ay sonrası için otomatik "tekrar fırsatı" kartı. Hesap kartı: müşteri yıllık ciro, kâr, kazanma oranı, açık fırsatlar, kurumsal tercih notları.
Gerekçe: satış RFP'den önce başlar; kurum hafızası ve tekrar eden gelir. · Hedef: 7, 1, 6, 10 · **P1** · M · **Evet** (tam pipeline/kampanya Faz 3'te kalır)
Ana çatı: uyumlu (1: sözleşme eklemeli; 3: fırsat silinmez, "vazgeçildi" durumu).

**K3. Kurumsal kanal + kişisel mesaj içe alma (WhatsApp politikası)**
(a) Acenta WhatsApp Business numarası, kişiye atanmış konuşma, yanıt insanın adıyla ve onayıyla; (b) kişisel WhatsApp için "Sisteme ilet" kısayolu ve dışa aktarılmış sohbetin içe alınması (AI ayıklar, projeye bağlar, rakam/tarih/pax/onay içeren mesajları işaretler); (c) çeyreklik "kaynaksız değişiklik" raporu.
Gerekçe: ilişkiyi koparmadan bilgiyi şirkette tutmak. · Hedef: 7, 6, 2, 5 · **P1** · M · **Evet**
Ana çatı: uyumlu, ancak teknoloji komitesi "insanın adresinden" ilkesinin kurumsal WhatsApp numarasında nasıl sağlanacağını (kişi adı + atama + audit) doğrulamalı. İçe alınan sohbetlerde misafir verisi varsa modele gönderilmeden maskelenmeli (ana çatı 9).

**K4. "Söz verildi" kaydı ve değişiklik maliyeti şeffaflığı**
Sözlü/yazılı her taahhüt (pax artışı, ek hizmet) bir değişiklik kaydı açar; mevcut değişiklik akışını tetikler. Revizyonda sabit/değişken maliyet ayrımı ile yeni kişi başı fiyat ve marj etkisi (iç) + müşteriye maliyet etkisi (dış) hesaplanır; müşteri onay linkiyle teyit eder.
Gerekçe: marj erimesinin ana kaynağı revizyonlar (GM: ~3,8 puan); alıcı sürpriz faturayı istemiyor. · Hedef: 10, 2, 9, 5 · **P1** · M · **Evet**
Ana çatı: uyumlu (4: revizyon belgeleri stale/yeniden üretim; 5: teklif onayı kapısı korunur).

**K5. Pax bandı fiyatlaması ve kesinti (attrition/cut-off) takvimi**
Teklifte isteğe bağlı pax bantları (her bant kendi maliyet hesabından üretilir). Tedarikçi sözleşmesindeki kesinti tarihleri ve ceza kademeleri müşteri teklifine/sözleşmesine ve portala yansır; tarih yaklaşırken satışçıya ve müşteriye (insan onaylı) hatırlatma taslağı.
Gerekçe: sık pax değişikliğinde revizyon yükünü ve ceza riskini azaltır. · Hedef: 10, 2, 3, 8 · **P1** · M · **Evet**
Ana çatı: uyumlu.

**K6. Müşteri bazında fiyat modeli: gömülü markup / açık kitap + yönetim ücreti / hibrit**
Müşteri kuralı olarak seçilir. Açık kitapta müşteriye net alış, yönetim ücreti, beyan edilen komisyon/override gösterilir; kanal fiyatı, avantaj %, pazarlık notları ve diğer teklifler hiçbir modelde gösterilmez. Yönetim ücreti için de markup ve marj ayrı gösterilir.
Gerekçe: büyük kurumsal ve ilaç müşterilerinde çerçeve sözleşme şartı; SaaS'ta kurumsal paket farklılaştırıcısı. · Hedef: 10, 9, 5 · **P1** · M · **Evet**
Ana çatı: uyumlu (7: EUR iç, marj/markup ayrı; 8: model kural tablosunda).

**K7. Markup öneri motoru (sezon, şehir talep takvimi, lead time, segment, müşteri geçmişi)**
Rules tablosuna isteğe bağlı boyutlar; varsayılan = mevcut kademe tablosu. AI gerekçeli öneri gösterir; satışçı hedef marj üstünde serbest; altı karar kutusuna düşer (mevcut). "Stratejik yatırım" gerekçe kodu ile açılan teklifler 12 ay sonra müşteri yaşam boyu kârlılığıyla geri raporlanır.
Gerekçe: statik tablo yoğun dönemde marj bırakıyor, durgun dönemde iş kaybettiriyor. · Hedef: 10, 3 · **P2** · M · **Evet (yalnız sezon + segment boyutu ve stratejik gerekçe kodu)**; tam talep takvimi v0.6
Ana çatı: uyumlu (8: kurallar tabloda, AI yalnız öneri; 6: AI kural değiştiremez).

**K8. Kanal fiyatı kanıtı**
Manuel girilen her OTA/toptancı fiyatı için zaman damgası, koşullar (iade, pansiyon, oda tipi) ve ekran görüntüsü/kaynak zorunlu; 72 saatten eski kanal fiyatı "bayat" uyarısı. Otomatik erişim yalnız lisanslı rate-shopping API'leri üzerinden araştırılsın.
Gerekçe: yanlış pozitif avantaj = yanlış markup. · Hedef: 10, 8, 2 · **P1** · S · **Evet**
Ana çatı: uyumlu.

**K9. Acil teklif modu ve bid/no-bid kartı**
Proje "acil" işaretlenince takip süreleri (24/48 saat) kural tablosundaki acil değerleriyle (ör. 4/8 saat) çalışır; kontrat fiyatı olan kalemler RFQ'suz fiyatlanır. Yeni RFP'de geçmiş veriden "benzer işlerde kazanma oranı, ortalama marj, gereken efor" özetli teklif-verelim-mi kartı.
Gerekçe: son dakika RFP'leri ve ekip kapasitesinin doğru işe yönlendirilmesi. · Hedef: 3, 10, 1 · **P1** (acil mod) / **P2** (bid/no-bid) · S / M · **Evet / Evet (basit sürüm)**
Ana çatı: uyumlu (8: süreler kural tablosunda).

**K10. İlk yanıt SLA sayacı ve tek dokunuş teyit**
Talep geldiği anda "ilk yanıt" sayacı (varsayılan 2 saat, kural); AI teyit + eksik bilgi soruları taslağını hazırlar; sorumluya push, tek dokunuş onay, kendi adresinden gider. Mesai dışı için nöbetçi vekil ataması; süre dolmak üzereyken karar kutusuna kart. İlk yanıt ve teklif süresi müşteri bazında raporlanır (alıcının ajans puanlamasıyla aynı metrik).
Gerekçe: alıcıların ajans puanlamasında birinci kriter. · Hedef: 3, 5, 6 · **P1** · S · **Evet**
Ana çatı: uyumlu (otomatik gönderim yok; bkz. Soru S1).

**K11. Çok dilli belge ve gösterim para birimi**
Teklif/sözleşme/portal şablonları TR + EN zorunlu, diğer diller opsiyonel; AI çeviri taslağı + insan onayı. Müşteriye gösterim/sözleşme para birimi (EUR/USD/TL) ayrı alan; teklif tarihinde kilitli kur, geçerlilik süresi ve kur riski maddesi otomatik.
Gerekçe: uluslararası kongre ve yabancı müşteriler; kur riski marj erimesi. · Hedef: 3, 9, 10 · **P1** (EN + kur kilidi) / P2 (diğer diller) · M · **Evet**
Ana çatı: uyumlu (7: iç para birimi EUR değişmez; yalnız gösterim katmanı).

**K12. Müşteri uyum (compliance) kuralları**
Müşteri bazında: kişi başı harcama tavanı, yasak mekân/kategori, refakatçi masrafı yasağı, bilimsel program oranı, zorunlu belgeler; teklif ve saha ekstralarında otomatik kontrol ve ihlalde blok/karar kartı. Katılımcı bazlı "sağlanan değer" raporu sistem içinde üretilir (misafir verisi modele gitmez).
Gerekçe: ilaç/finans müşterilerinde seçilme sebebi; hata riskini azaltır. · Hedef: 2, 9, 6 · **P2** · M · **Evet (kural altyapısı + teklif kontrolü)**; katılımcı bazlı rapor v0.6 [Doğrulanmalı: TİTCK tanıtım yönetmeliği ve sektör etik kuralları]
Ana çatı: uyumlu (8, 9).

**K13. Bütçe/maliyet merkezi bölüştürme ve müşteri PO takibi**
Proje maliyetinin müşteri maliyet merkezlerine oranla bölünmesi, merkez bazında fatura/ön fatura; PO tutarına karşı harcama göstergesi (portalda).
Gerekçe: büyük kurumsal alıcılarda fatura reddinin ana nedeni. · Hedef: 10, 5, 2 · **P2** · M · **Evet (finans komitesi onayıyla)**
Ana çatı: uyumlu.

**K14. Satışçı panosu, prim görünürlüğü ve adil performans**
Satışçı kendi panosunda: açık fırsatlar, opsiyon alarmları, kazanma oranı (segment içi, ciro ağırlıklı), gerçekleşen kâr ve buna bağlı **prim tahmini** (prim kuralı rules tablosunda, finans onaylı). Akran sıralaması varsayılan kapalı (acenta kuralı).
Gerekçe: benimsemenin (adoption) ana motoru; "gözetim" algısını "fayda"ya çevirir. · Hedef: 6, 10, 1 · **P1** · M · **Evet (pano + kazanma oranı); prim hesabı finans/İK kararına bağlı**
Ana çatı: uyumlu.

**K15. Hesap devri (çalışan ayrılışı / izin)**
Ayrılış veya uzun izinde AI; müşteri kartı, açık fırsatlar, açık sözler, kurumsal tercihler, kritik tarihlerden devir özeti taslağı üretir; yeni sorumlu atanır; müşteriye tanışma mesajı (insan onaylı) gider. Kişisel hassas notlar şifreli ve yalnız yetkiliye.
Gerekçe: hedef 7'nin doğrudan uygulaması. · Hedef: 7, 5, 6 · **P1** · S · **Evet**
Ana çatı: uyumlu (3, 6, 9).

**K16. Kayıp/kazanç analizi ve kurumsal tercih notları**
Kayıp nedeni taksonomisi (fiyat, tarih, rakip, iptal, müşteri içi karar…), kaybedilen rakip adı ve bilinen fiyat (yalnız iç kullanım; tedarikçi pazarlığında kullanılmaz — mevcut yasak korunur). Müşteri kartında iki not türü: "kurumsal tercih" (modele gidebilir) ve "kişiye ait hassas not" (şifreli, modele gitmez).
Gerekçe: Ece'nin öğrenme ihtiyacı; satış kararı. · Hedef: 7, 10, 3 · **P2** · S · **Evet**
Ana çatı: uyumlu (9) [Doğrulanmalı: ticari muhatap verisinin KVKK dayanağı].

**K17. Vaka çalışması / referans kartı üretimi (pazarlama)**
Kapanışta AI anonim vaka taslağı; isimli kullanım yalnız müşteri onay linkiyle; misafir görselleri rıza olmadan kullanılamaz. Ticari e-ileti için İYS onayı kaydı (kampanya modülünün ön koşulu).
Gerekçe: satış materyali + SaaS pazarlaması. · Hedef: 7, 3 · **P3** · S · Hayır (v0.6)
Ana çatı: uyumlu (6: dış mesaj insan onaylı; 9).

**K18. SaaS paketleme, sade mod ve özellik bayrakları**
Butik / Profesyonel / Kurumsal-DMC paketleri; açık kitap, uyum, çok dil, B2B (acenta müşteri tipi, komisyonlu net fiyat), kayıt platformu entegrasyonu üst paketlerde. Butikte "sade mod". İlk veri yükü satış argümanı olarak onboarding'in merkezinde. Müşteri sayfaları white-label; tedarikçi sayfasında "powered by" varsayılan kapalı, açana teşvik.
Gerekçe: tüm sektöre satılabilirlik. · Hedef: (ticari) 6, 7 · **P2** · M · Kısmen (müşteri tipi "B2B acenta" ve özellik bayrakları evet; abonelik/faturalama Faz 3)
Ana çatı: uyumlu (özellik bayrakları kiracı bazında; kiracılar arası veri yok).

**K19. Katılımcı kayıt — inşa değil entegrasyon**
PCO segmenti için yaygın kayıt platformlarıyla entegrasyon (kayıt sayısı → pax güncellemesi → K4 değişiklik akışı). Kendi kayıt modülü sonra değerlendirilir.
Gerekçe: PCO'ya satış ön koşulu; inşa eforu çok yüksek. · Hedef: 1, 2, 3 · **P3** · L · Hayır (teknoloji komitesi araştırsın)
Ana çatı: uyumlu, misafir verisi şifreli içe alınmalı (9).

---

## 4) Ürün sahibine sorular

**S1. Mesai dışı "talebiniz alındı" otomatik teyidi gönderilebilir mi?**
- (a) Hayır, ana çatı 6 aynen korunur; tek dokunuş onay + nöbetçi vekil (K10). 
- (b) Yalnız yöneticinin önceden onayladığı, değişken içermeyen (tarih/fiyat/taahhüt yok) tek bir sabit şablon, mesai dışında, insanın adına otomatik gidebilir; her gönderim audit'e düşer. (Ana çatı 6'nın değiştirilmesini gerektirir.)
- (c) Otomatik değil ama ilk sabah 08:30'da kuyruğa alınmış taslakların toplu tek onayı.
- **Komite önerisi: (a) + (c).** Bölünme: Pazarlama Direktörü ve alıcı (b)'yi destekliyor (5'e 2, 1 çekimser).

**S2. "Tedarikçiye müşteri adı gizli" kuralına müşteri bazında istisna açılsın mı?** (Müşterinin kendi kurumsal otel anlaşması olduğunda.)
- (a) Hayır, kural mutlak.
- (b) Evet, müşteri kuralı "adı tedarikçiye açılabilir" + her RFQ'da yönetici kararı.
- (c) Evet, müşteri kuralıyla kalıcı açık (karar gerekmez).
- **Komite önerisi: (b).**

**S3. Açık kitap modelinde tedarikçi komisyon/hacim primleri nasıl ele alınsın?**
- (a) Sistem yalnız beyan alanı tutar, iade müşteri sözleşmesine göre manuel.
- (b) Müşteri kuralına göre otomatik "iade" kalemi olarak müşteri faturasına düşer.
- **Komite önerisi: (a) v0.5, (b) finans komitesi onayıyla v0.6.**

**S4. Satışçı primi sistemde hesaplansın mı?**
- (a) Hayır, yalnız gerçekleşen kâr gösterilir.
- (b) Prim kuralı (rules tablosu) ile tahmini prim satışçıya görünür; kesin prim finans onayıyla.
- (c) Prim hesaplaması ve onayı tamamen sistemde (karar kutusu).
- **Komite önerisi: (b)** — benimsemenin ana anahtarı; İK/finans politikası gerekli.

**S5. CRM'in hafif bölümü (K2) Faz 3'ten v0.5'e çekilsin mi?**
- (a) Evet, fırsat + yıllık tekrar + hesap kartı. (b) Hayır, Faz 3'te bütün olarak.
- **Komite önerisi: (a).**

**S6. Ekip performansında akran sıralaması varsayılanı?**
- (a) Kapalı (kişi kendini, yönetici herkesi görür). (b) Açık.
- **Komite önerisi: (a)**, acenta kuralıyla değiştirilebilir.

**S7. Sektörel anonim karşılaştırma (benchmark) yapılsın mı?** (Bkz. Ana çatı çelişkisi Ç2.)
- (a) Hiç yapılmaz. (b) Yalnız açıkça katılan kiracılardan, fiyat içermeyen süreç metrikleri (yanıt süresi, kazanma oranı aralığı), ayrı ve onaylı bir toplama süreciyle. (c) Fiyat endeksi dahil.
- **Komite önerisi: (a) şimdilik; Faz 3'te (b) teknoloji ve hukuk görüşüyle.** (c) reddedildi.

**S8. Tedarikçi sayfasında "powered by" imzası varsayılanı?**
- (a) Kapalı (komite çoğunluğu). (b) Açık, kapatma üst pakette.
- **Komite önerisi: (a)**, açan acentaya abonelik teşviki.

---

## 5) Ana çatı çelişkileri

**Ç1 — Otomatik "alındı" teyidi (ana çatı 6: dışarıya giden her mesaj insan onaylı).**
Öneren: Pazarlama Direktörü, alıcı. Çelişki: AI/sistem insan onayı olmadan dış mesaj göndermiş olur.
Uyumlu alternatif: K10 (AI taslak → push → tek dokunuş onay, insanın adresinden; nöbetçi vekil; SLA kartı karar kutusunda). Karar ürün sahibinde (S1).

**Ç2 — Kiracılar arası sektörel benchmark (ana çatı 2: tenant_id + FORCE RLS, kiracı izolasyonu).**
Öneren: Pazarlama Direktörü. Çelişki: kiracı verilerinin birleştirilmesi izolasyonu deler; ayrıca acentaların pazarlık verisi rakiplere sızma riski.
Uyumlu alternatif: kiracı içinde "kendi geçmişinize göre" karşılaştırma (şimdi); ileride yalnız açık rızalı kiracıların, kiracının kendi içinde hesaplanmış fiyat içermeyen özet metriklerini ayrı bir hizmete göndermesi (kiracı verisi tablolarına çapraz erişim olmadan). Karar ürün sahibinde (S7).

**Ç3 (önlendi) — Satışçının hedef marj altı teklifi kendisinin açması.**
Kıdemli satışçının "stratejik müşteri" itirazı ilk hâlinde ana çatı 5 ile (onay kapıları karar kutusunda) ve önceki ürün kararıyla çelişiyordu. Uyumlu alternatif benimsendi: "stratejik yatırım" gerekçe kodu + yönetici kararı + 12 ay sonra yaşam boyu kârlılık geri raporu (K7).

**Not (mimari değil, önceki ürün kararı):** "Tedarikçiye müşteri adı gizli" — S2'de istisna soruldu.

---

## 6) Diğer komitelere sorular / bağımlılıklar

**Finans**
- K6 açık kitap: yönetim ücreti faturalaması, komisyon/override beyanı ve iadesi (S3); tedarikçi faturası kopyasının müşteriye ibrazı.
- K11: müşteriye USD/TL gösterim ve fatura, teklifte kur kilidi, kur farkı faturalaması; iç EUR raporlamayla mutabakat.
- K13: maliyet merkezine bölünmüş fatura, PO tutarı takibi; Mikro dışı programlara (Logo, Netsis, Luca, Paraşüt) aktarım butik SaaS için kritik.
- K14/S4: prim formülü (gerçekleşen kâr, TL/EUR, tahsilat şartı).
- K4: revizyonda sabit/değişken maliyet sınıflandırması kalem türü bazında kim tanımlar?

**Tedarik**
- Kontrat (yıllık anlaşmalı) fiyat + allotment + kesinti (cut-off/attrition) yönetimi — K5 ve K9'un ön koşulu; komitemiz P1 öneriyor.
- Açık kitap modeli için tedarikçi sözleşmelerine "faturanın müşteriye ibrazı" ve komisyon beyanı maddesi.
- S2: müşterinin kendi kurumsal otel anlaşması olduğunda RFQ akışı.
- Pax bandı fiyatlaması için tedarikçiden bant bazlı fiyat alınması (RFQ formuna alan).

**Operasyon**
- K1 portal: saha 7/24 irtibat ataması, rooming durumu görünürlüğü (KVKK sınırında, misafir adları değil sayılar).
- K4: "söz verildi" kayıtlarının operasyon değişiklik akışına bağlanması; saha ekstralarının (5.000/15.000 TL) müşteri uyum kuralıyla (K12) birlikte kontrolü.
- K19: kayıt platformundan gelen pax değişiklikleri.

**Yönetim–İK**
- K3: müşteri iletişim bilgisinin şirkete ait olduğuna dair çalışan politikası; kurumsal WhatsApp kullanımı.
- K14/S6: performans görünürlüğü, prim politikası.
- K15: ayrılış/izin devri prosedürü ve süresi.
- K10: mesai dışı nöbetçi vekil çizelgesi ve ücretlendirmesi.

**Teknoloji**
- K3: WhatsApp Business Cloud API'de "insanın adresinden" ilkesinin (kişi adı, atama, audit) karşılanması; dışa aktarılmış sohbet içe alımında misafir verisi maskeleme.
- K8: lisanslı rate-shopping API seçenekleri [Doğrulanmalı: kullanım şartları].
- K11: çok dilli şablon motoru, portal dil seçimi.
- K18: kiracı bazında özellik bayrakları, white-label müşteri sayfaları.
- Ç2: benchmark yapılacaksa izolasyonu bozmayan mimari.
- K17: İYS entegrasyonu (kampanya modülünden önce).
- Tüm yeni tablolar (fırsat, müşteri tercih notu, fiyat modeli, maliyet merkezi): `apply_standard_policies` + `apply_tenant_foreign_keys`, silinmez kayıt; sözleşme (`api.ts`) değişiklikleri eklemeli.
