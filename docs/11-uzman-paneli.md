# 11 — Uzman paneli: genel kurul, kararlar ve v0.5 kapsam önerisi

> Konu: MICE AI Operations OS (PRD v0.4 uygulaması) — altı uzman komitesinin (Ticari, Tedarik, Finans, Operasyon,
> Yönetim–İnsan, Ürün–SaaS) raporlarının genel kurulda birleştirilmesi; ürün sahibinin 10 hedefine ve **tüm acentalara
> satılabilirliğe** göre önceliklendirme; PRD v0.5 için gerçekçi kapsam.
> Kaynaklar: [ortak brifing](panel/BRIEF.md), altı komite raporu ([Ek](#ek-komite-raporları)), `CLAUDE.md` ana çatı (1–9),
> [10-senaryolar.md "Ürün sahibi kararları"](10-senaryolar.md#ürün-sahibi-kararları-22112026) (Q1–Q9; yeniden sorulmadı,
> yalnız bir komitenin gerçek sorun gösterdiği yerde — S-08 — açıldı).
> Kişiler kurgusaldır; anekdotlar sektörde sık yaşanan durumları temsil eder. Kod okunmadı. Rakamlar temsilîdir.
> İşaretler: `[Ürün kararı]` ürün sahibinin seçimi, `[Doğrulanmalı]` hukuk/vergi/tedarikçi/pazar teyidi,
> **ANA ÇATI ÇELİŞKİSİ** = `CLAUDE.md` ana çatısını değiştirmeyi gerektiren öneri.

---

## Özet — panelin 10 ana sonucu

1. **Çekirdek doğru, v0.5 "eksik halkalar" sürümü olmalı.** 0–8 akışı, karar kutusu, tek doğru kaynak ve kapalı AI yetki
   listesi altı komitenin de ortak onayını aldı. v0.5'in teması yeni ürün alanları açmak değil, **para kaybettiren ve kişiye
   bağımlı kalan halkaları** kapatmaktır: tedarik taahhütleri, ödeme planı, devir-teslim, müşteri irtibatı, saha gerçekliği.
2. **Ana çatı korunur.** Panelde dile getirilen 20'den fazla ana çatı çelişkisinin tamamı için uyumlu alternatif bulundu.
   Yalnız beş konu ürün sahibinin kararına gidiyor (S-01, S-02, S-19, S-22, S-24); panelin önerisi her birinde ana çatıyı
   **değiştirmemek**.
3. **"Otomatik dış mesaj" taleplerinin hepsi tek desende çözülür.** "Talebiniz alındı" (Ticari, SaaS), gece rötar bildirimi
   (Tedarik), kriz mesajı (Operasyon), tahsilat hatırlatması (Finans) için ortak **hızlı onay deseni** (K-01): AI taslak →
   sorumluya push → tek dokunuş → insanın adresinden; toplu kart, nöbetçi, süreli eskalasyon. Bu türler "otomasyona terfi etmez".
4. **Tedarik çekirdeği v0.5'in bir numaralı ticari gerekçesi.** Kontrat fiyatı, allotment/attrition (domain'de saf fonksiyon),
   opsiyon sırası ve uzatma. Tek bir release kararının yanlış günde verilmesi 12.600 EUR'ya mal olabiliyor (Komite B örneği).
   Hedef 8 (fiyat değişkenliği) ancak kontrat fiyatı çıpa olunca ölçülebilir hale gelir.
5. **Kontrol kurallarının hepsi tek kalıpta: "uyar + gerekçe + Face ID ile istisna + haftalık istisna listesi"**, acenta isterse
   "blok" seçer. "Kapora önce", kredi limiti, marj altı teklif, kur politikası istisnası bu kalıba girer. Butikten DMC'ye fark
   kodla değil kuralla (ana çatı 8) çözülür.
6. **Finans: ödeme planı + kapora önce + ödeme güvenliği + üç kolonlu kârlılık v0.5'te; fatura kesmek yok.** Vergi
   doğruluğu dalgası (kalem faturalama modeli, kur farkı motoru, ters belge, dönem kilidi) mali müşavir teyidinden sonra v0.6'da.
   Q5 kararı (gerçek kurla kâr) aynen geçerli; yalnız "banka kur marjı" satırı ekleniyor.
7. **İnsan tarafı: "Sistem işi kaydeder, insanı gözetlemez."** Q7 ekip performansı raporu korunur ama bağlamlanır (segment,
   ciro ağırlığı, karar bekleme süresi ayrı satır, itiraz notu); akran sıralaması varsayılan kapalı; **çalışan profilleme AI
   yasak listesine** eklenir; devir-teslim bir iş akışı olur. Prim hesabı v0.6'ya, İK/hukuk görüşünden sonra.
8. **Müşteriye güvenilir irtibat ve hedef 9'un dürüst ürünü v0.5'te.** Müşteri proje portalı + irtibat kartı (sorumlu, yedek,
   nöbetçi), ilk yanıt SLA'sı; yazışma analizinde **kaynaklı cevap zorunluluğu + soru takip listesi** ("cevaplandı /
   cevaplanmadı / çelişkili").
9. **Operasyon: program verisi temel taş.** Rooming revizyon farkı, değişiklik yayını, asgari katılımcı nesnesi, kriz paketi
   ve şifreli **çevrimdışı okuma paketi** v0.5'te; transfer modülü v0.6'nın ilk işi (uçuş ve program verisine bağımlı); uçak
   için yalnız **takip katmanı** (bilet kesme yok); PCO'ya "asgari kapı", tam kayıt platformu yok.
10. **SaaS: "önce canlıda doğrula, sonra yeni entegrasyon."** Güvenlik çekirdeği, PDF/görsel PII maskeleme, AI kullanım ölçümü,
    "AI'sız da çalışır" modu, gerçek doğruluk seti v0.5'te. Konumlandırma: *"Etkinlik yazılımı değil; acentanın kâr ve hafıza
    sistemi. AI okur ve hazırlar, siz karar verirsiniz — AI'sız da çalışır."* v0.5 = **37 karar (2'si kod dışı), ≈ 100
    geliştirici-haftası**; 26 soru ürün sahibine, **8'i v0.5 başlamadan acil**.

---

## Katılımcılar

| Komite | Genel kurul temsilcileri (rapordaki diğer üyeler parantezde) | Masaya getirdiği öncelik |
|---|---|---|
| **A — Ticari** ([rapor](panel/A-ticari.md)) | Nesrin Aydemir (Satış Direktörü), Burak Tunç (Gelir Müdürü), Selim Erkan (Pazarlama Direktörü), **Dr. Zeynep Karaca** (dış ses: ilaç firması satın alma/etkinlik müdürü) · (Murat Kılıç, Ece Yalçın, Deniz Akın, Aylin Özgür) | Hız, kazanma oranı, müşteri irtibatı, şeffaflık, benimseme |
| **B — Tedarik** ([rapor](panel/B-tedarik.md)) | Serap Aydın (Satın Alma Direktörü), Kerem Özbek (Otel İlişkileri), Levent Kaya (Uçak bileti), **Hande Yılmaz** (dış ses: 5* otel Grup & MICE Satış Müdürü) · (Murat Demirci, Elif Taşkın, Nazlı Er) | Kontrat fiyatı, allotment, opsiyon, time limit, adil skor, karşılıklılık |
| **C — Finans** ([rapor](panel/C-finans.md)) | Nermin Aksoy (Finans Direktörü), Hakan Türkmen (SMMM), Aylin Korkmaz (İç Denetçi), Emre Yıldız (butik acenta fatura/banka) · (Derya Çelik, Serkan Bal, Gülşen Arı, Tolga Er — bulut muhasebe, Murat Kaya — hazine, Selin Öztürk — banka) | Kur, kapora, vergi matrahı, ödeme güvenliği, muhasebe aktarımı |
| **D — Operasyon** ([rapor](panel/D-operasyon.md)) | Murat Kılınç (Saha Koordinatörü), Ahmet Sezer (Verimlilik Uzmanı), Hakan Öztürk (Kriz Yönetimi), Dr. Elif Tunç (PCO), **Nilay Karaca** (dış ses: müşteri etkinlik müdürü / VIP) · (Operasyon Direktörü — B'deki satın alma direktörüyle adaş, Gülşen Erdem, Kerem Bayraktar) | Program verisi, rooming, çevrimdışı saha, kriz, katılımcı |
| **E — Yönetim–İnsan** ([rapor](panel/E-yonetim-insan.md)) | Kemal Aydın (Acenta Sahibi), Selin Ertürk (Acenta Müdürü), Dr. Nesrin Kaya (Etik/İK), Av. Murat Demir (KVKK/İş Hukuku), **Tolga Er** (dış ses: ayrılmak üzere olan kıdemli satışçı) · (Burak Tan, Deniz Altun, Hasan Yıldız, Elif Şahin) | Kontrol–adalet dengesi, devir, gözetim sınırı, tükenmişlik |
| **F — Ürün–SaaS** ([rapor](panel/F-urun-saas.md)) | Ürün Müdürü (ÜM), Yapay Zekâ Uzmanı (YZ), Bilgi Güvenliği (BG), Entegrasyon Mimarı (EM), **Butik acenta sahibi (BA)** (dış ses) · (Fiyatlandırma/İş Modeli — FİM, Sektör Analisti — SA, Destek/Onboarding — MD) | Satılabilirlik, güvenlik, AI'nın dürüst sınırları, maliyet, kapsam disiplini |
| Moderatör | Panel moderatörü (tutanak, ana çatı denetimi) | — |

Ad çakışmaları: Komite C'deki "Tolga Er" bulut muhasebe uzmanı, Komite E'deki "Tolga Er" satışçıdır; tutanakta parantezle ayrılır.

---

## Genel kurul tartışması

Genel kurul altı tur sürdü. Her tur bir çatışma ekseni etrafında kuruldu; her çatışma ya bir karara (K-xx) ya da ürün
sahibine çerçevelenmiş bir soruya (S-xx) bağlandı. Moderatör her öneriyi ana çatıya karşı okudu.

### Tur 1 — Açılış: her komite "en pahalı üç boşluk"

**Nesrin Aydemir (A):** "Üç şey: ilk yanıt hızı, müşteriye tek ve kalıcı irtibat, satış öncesi dünyanın (fırsat, tekrar eden
etkinlik) sistemde olmaması. Alıcılar ajansları ilk 2 saatteki teyide göre puanlıyor."

**Serap Aydın (B):** "Kontrat fiyatı yok, allotment yok, opsiyon sırası yok. Sistem her talepte piyasayı sıfırdan soruyor;
bu hedef 8'in tersi. Bir de 'iyi fiyat' sinyali enflasyonla kirlenmiş medyana dayanıyor; yanlış güven veriyor."

**Nermin Aksoy (C):** "Kur politikası teklifte belirlenmiyor, kapora gelmeden tedarikçiye ödeme yapılabiliyor, ödeme planı
diye bir nesne yok. Ve sahte IBAN değişikliği: Aylin Hanım'ın incelediği vakada 186.000 EUR gitti."

**Murat Kılınç (D, saha):** "Sahada internet yok, rooming altı kez değişiyor, program 'final_v3_SON.docx'. Çevrimdışı okuma
olmazsa ilk etkinlikte herkes WhatsApp'a döner."

**Kemal Aydın (E):** "İki kez kıdemli satışçım müşteri portföyüyle gitti. Her şeyi görmek istiyorum."
**Dr. Nesrin Kaya (E):** "Göreceksiniz — işi. İnsanın ham davranış izini değil. Asıl açık devir-teslim: bilgi hâlâ kişinin kafasında."

**ÜM (F):** "Satılabilirlik için üç engel: 'uygulandı ama canlı test edilmedi' entegrasyonlar, PDF'te PII maskeleme yokluğu,
AI maliyetinin ölçülmemesi. Ve paketleme: butik acenta sade ekran ister."

**Moderatör:** Altı komite toplam ~150 karar önerdi. Tekrar edenleri birleştirdim: *müşteri irtibat kartı/portal* üç komitede
(A-K1, D-D8, E-K4), *devir-teslim* iki komitede (A-K15, E-K1/K2), *ödeme planı* iki komitede (B-K9, C-K5), *kanal fiyatı
kanıtı* iki komitede (A-K8, B-K7), *kur kilidi/politikası* üç komitede (A-K11, B-K8, C-K8), *transfer* üç komitede (B-K15,
D-D6, F-K-3a), *otomatik dış mesaj istisnası* dört komitede. Çatışmaları sırayla açıyorum.

### Tur 2 — Dış iletişim, hız ve kanal: ana çatı 6'nın sınavı

**Selim Erkan (A):** "Müşteri Cuma 23:00'te RFP gönderiyor. Değişkensiz bir 'aldık' mesajında risk yok. Rakip yazılımların
hepsi bunu yapıyor."
**Dr. Zeynep Karaca (A, alıcı):** "Ben de istiyorum. Ama dürüst olayım: benim için önemli olan teyidin 2 saat içinde gelmesi,
otomatik olması değil."
**BA (F):** "Ben de 'talebinizi aldık, 2 saat içinde döneceğiz' yazmak istiyorum, herkes yapıyor."
**Murat Demirci (B, transfer — Serap Aydın aktardı):** "Gece 02:40, Frankfurt uçağı 95 dakika rötarlı. Şoföre birinin haber vermesi
lazım; kart sabah görülürse üç saat bekleme parası öderiz."
**Hakan Öztürk (D):** "Deprem gecesi şablon hazırsa otomatik gitsin istedim; vazgeçtim, ama yayın tek dokunuş olmalı."
**Emre Yıldız (C):** "Ben de her gün beş kapora hatırlatmasını tek tek yazmaktan yoruldum."

**Nesrin Aydemir (A):** "Otomatik 'alındı, Salı teslim' mesajı bir taahhüttür. O işe 'teklif vermiyoruz' dersek müşteri bekler."
**YZ (F):** "Ve bugün sabit şablon, yarın 'şablona proje kodunu da ekleyelim', öbür gün 'eksik bilgi sorularını da'. Kapı bir
kez aralanırsa ana çatı 6 delinir."
**BG (F):** "İki uyumlu yol var: talep web formundan geliyorsa ekranda statik 'alındı' sayfası — bu bir *mesaj* değildir; e-posta
ve WhatsApp'ta ise sorumluya hazır taslak, tek dokunuş."
**Selin Ertürk (E):** "Tek dokunuş gece 23:00'te kime? Bana mı? Ben zaten darboğazım."
**Kerem Özbek (B):** "Nöbetçiye. Ve 10 dakika içinde açılmazsa vekile. Rötarda da aynı: şoför mesajı değil, transfer firmasına
giriş gerektirmeyen *canlı manifest linki* (bilgi çekilir, mesaj gitmez), saha nöbetçisine push, tek dokunuş."
**Aylin Korkmaz (C):** "Tahsilat için toplu kart: 'bugün gidecek 5 hatırlatma', her biri açılıp görülebilir, tek onay, her
mesaj ayrı denetim izi. Ve tahsilat hatırlatması, müşteri teklifi gibi, otomasyona **terfi etmemeli**."

**Moderatör — çözüm:** Dört komitenin talebi tek desene bağlandı: **K-01 hızlı onay deseni** (taslak → push → tek dokunuş →
insanın adresinden; toplu onay kartı; nöbetçi ve süreli eskalasyon kuralları `rules`'ta; web formunda statik alındı ekranı).
Tahsilat, kriz, rötar ve release/opsiyon bırakma mesajları `NEVER_AUTO` listesine eklenir. Satıcıların talebi tamamen
kapanmadığı için çerçevelenmiş soru: **S-01** (panel önerisi: istisna açılmaz; oy 21–4).

**Kanal çatışması.** **Murat Kılıç'ın (A) sözünü Tolga Er (E) sürdürdü:** "Müşteri benim numaramı biliyor, şirketinkini değil.
Kişisel WhatsApp'ımı bırakmam." **Kemal Aydın (E):** "O zaman sistem kişisel WhatsApp'ını ve Gmail'ini okusun."
**Av. Murat Demir (E):** "Bu ölçülülük ilkesine aykırı; çalışanın özel yazışmaları işlenir [Doğrulanmalı]. Ayrıca ana çatı 6'daki
'insanın adresi' kurumsal hesap varsayar." **Dr. Elif Tunç (D):** "Benim derdim başka: 300 katılımcıya program değişikliği. Kişinin
kendi WhatsApp'ından 300 mesaj atılamaz; acentanın kurumsal hattından gitmeli." **BG (F):** "Kurumsal hatta 'insanın adresi'
şöyle sağlanır: konuşma kişiye atanır, mesaj onaylayanın adıyla imzalanır, onaylayan kimlik denetim izine yazılır."
**Nilay Karaca (D, müşteri):** "Ama çalışanlarıma doğrudan mesaj benim iznimle olsun; varsayılan kapalı."

**Çözüm:** K-06 kanal politikası — kurumsal hesaplar, kişisel alan adları varsayılan engelli (butik kurucu için admin istisnası),
kişisel kanaldan "projeye ilet" + kaynak etiketi, sistem kişisel cihazı/hesabı **okumaz**; kurumsal WhatsApp hattı önerilir.
Yorum soruları: **S-02** (kurumsal hat "insanın adresi" sayılır mı) ve **S-09** (kişisel hesap istisnası). Murat Kılıç'ın şartı —
"primimi sistemde görürsem her rakamı iletirim" — Tur 4'e devredildi.

**Hız ↔ sessiz saat.** **Dr. Zeynep Karaca:** "İlk yanıt 2 saat." **Deniz Altun (E, yaşam koçu — Dr. Nesrin Kaya aktardı):** "Sistem
herkesi 7/24 açık tutarsa en iyiler ilk gider; fazla mesai delili de doğar [Doğrulanmalı]." **Ahmet Sezer (D):** "İkisi çelişmiyor:
SLA *iş saatinde* ölçülür, müşteri bazında 'acil' kuralı ve nöbet çizelgesi istisnadır." **Çözüm:** K-02 (SLA sayacı iş saatiyle,
müşteri/acil kuralıyla) + K-29 (sessiz saat varsayılan açık, kritikler geçer, nöbet/etkinlik modu istisna). Soru **S-14**.

### Tur 3 — Para: satış esnekliği ↔ finans kontrolü ↔ tedarikçi gerçekliği

**Burak Tunç (A):** "Revizyonlarda ve ekstralarda teklif marjı ile gerçekleşen marj arasında 3,8 puan kayıp var."
**Murat Kılıç'ın (A) itirazı Nesrin Aydemir'den:** "%6 marjla aldığımız otomotiv müşterisi üç yılda 11 proje verdi. Sistem
bloklasaydı o müşteri yoktu." **Nermin Aksoy (C):** "Marj altı teklif zaten yönetici gerekçesiyle açılıyor (Q1). Sorun marj
değil nakit: kapora gecikirse acenta 36.000 EUR'yu cebinden taşıyor; aynı haftaya iki proje denk gelirse açık 110.000 EUR."
**Kerem Özbek (B):** "Ama 'kapora gelmeden tedarikçiye ödeme yok' sert olursa otel Cuma 17:00'de blokeyi bırakır; müşterinin PO'su
Pazartesi çıkar." **Hande Yılmaz (B, otel):** "Biz iyi ödeyen acentaya iyi fiyat veririz. Geciken acentaya ikinci kongrede depozitoyu
%50 yaparım." **Aylin Korkmaz (C):** "O zaman blok değil, gerekçeli istisna. Denetimde ilk bakacağım liste 'kapora öncesi yapılan ön
ödemeler' olur."

**Çözüm (oybirliği):** Tüm finans kontrol kuralları tek kalıpta — *uyar + gerekçe + Face ID istisna + haftalık istisna
listesi*, acenta isterse *blok*. Bu kalıp "kapora önce" (K-16), kredi limiti (v0.6), kur politikası istisnası (K-15) için
geçerli. Satışın esnekliği korunur, kontrol kişiye değil sisteme bağlanır (hedef 6). "Stratejik yatırım" gerekçe kodu ve 12 ay
sonra müşteri yaşam boyu kârlılık geri raporu v0.6'ya (K-41). Soru **S-06**.

**Kur.** **Serap Aydın (B):** "Anadolu otelleri TL fiyat veriyor, 30 gün geçerli; müşteriye 120 gün sonrası için EUR veriyoruz."
**Hakan Türkmen (C):** "Ve kur farkı faturası en çok kavga edilen konu." **Burak Tunç (A):** "1.800 kişilik kongrede %3 kur
hareketi tüm marjı yer." **Dr. Zeynep Karaca:** "Kurumsal müşteri olarak kur maddesini görmek isterim; ama sizin tamponunuz sizin
işiniz." **Çözüm:** üç komitenin önerisi tek karar: K-15 — teklifte zorunlu *kur politikası* alanı (EUR teklif / TL + ödeme günü
kuru maddesi / TL sabit + tampon), fiyat kilidi alanları, tedarikçi tarafında TL sabit/endeksli bilgisi, kur hareketiyle hedef
marjın altına düşen projede kart. Tampon varsayılan görünmez, acenta kuralıyla madde olarak gösterilir: **S-07**.

**TL mi EUR mu?** **Tolga Er (C, bulut muhasebe):** "Yalnız yurtiçi çalışan Ankara acentasına 'iç para biriminiz EUR' tuhaf gelir."
**FİM (F):** "Dubai'deki DMC de USD diyecek." **Moderatör:** Kiracıya iç para birimi seçtirmek **ANA ÇATI ÇELİŞKİSİ (7)**.
**Emre Yıldız (C):** "Benim görmek istediğim TL rapor; iç hesap umurumda değil." **Çözüm:** iç hesap EUR kalır, her tutar kaynak
para birimiyle saklanır (zaten), Q5 gereği TL kâr ödeme/tahsilat günü kuruyla zaten var; v0.6'da kiracı bazında *görüntüleme/
raporlama para birimi* (TL/USD). Soru **S-19**.

**Q5 teyidi:** Komite C "fiili banka kuru ana gösterge" sorusunu (C-S1) sordu. Moderatör: Q5 kararı zaten "her hareket kendi
gerçek kuruyla (banka / dekont / e-Fatura / ödeme kaydı), yoksa TCMB" diyor. Yeniden sorulmadı; K-19 ile yalnız "banka kur marjı"
satırı ve fiili kur yoksa "tahmini" etiketi eklendi.

**Faturalama modeli ↔ ürün sadeliği.** **Hakan Türkmen (C):** "Aracılık diye beyan edilen işin incelemede kendi nam ve hesabına
satış sayılıp tam matrahtan KDV tarhiyatı yediğini gördüm. Kalem düzeyinde dört model şart." **BA (F):** "Ben 40 proje yapıyorum,
dört faturalama modeli ekranda görürsem kaçarım." **Nermin Aksoy:** "Ekranda değil, kalemde. Varsayılanı kalem türünden gelir,
sade modda gizli." **Hakan Türkmen:** "Ama oranları ve modelleri koda yazmadan önce SMMM teyidi lazım; mevzuat sık değişiyor."
**Çözüm:** "vergi doğruluğu dalgası" (kalem modeli, yürürlük tarihli vergi kuralları, kur farkı motoru, ters belge, dönem kilidi)
**v0.6**'ya; v0.5'te önce `[Doğrulanmalı]` maddeler mali müşavirle kapatılır. v0.5'te yalnız Mikro sütun doğrulaması ve VKN ile
cari eşleme (K-20). **Fatura kesimi:** Komite C 7/10 "v0.5'te yok"; müşavir kanalını rakip değil ortak yapmak için. Soru **S-17**.

**Müşteri adı gizli ↔ kurumsal otel anlaşması.** **Dr. Zeynep Karaca:** "Zincir otellerle kendi kurumsal anlaşmamız var. Otel
adımızı bilmeden bu fiyatı nasıl verecek?" **Serap Aydın (B):** "Gizlilik kuralı tedarikçinin müşteriye doğrudan gitmesini
engellemek için var; kaldırılmamalı." **Hande Yılmaz:** "Kurumsal anlaşma varsa biz zaten müşteriyi tanıyoruz; gizlemek fiyatı
kaybettirir." **Çözüm:** önceki ürün kararı (tedarikçiye müşteri adı gizli) gerçek bir sorunla karşılaştığı için açıldı:
**S-08** — müşteri bazında, yalnız müşterinin kurumsal anlaşma listesindeki tedarikçiler için, bir kez yönetici kararıyla açılan,
geri alınabilir istisna; RFQ'da görünür uyarı.

**Açık kitap.** **Dr. Zeynep Karaca:** "Çerçeve sözleşmede net fiyat + %8–12 yönetim ücreti istiyoruz." **Burak Tunç:** "Net
gösterilir; kanal fiyatı, avantaj yüzdesi, pazarlık notları hiçbir modelde gösterilmez." **ÜM (F):** "Bu kurumsal paket
farklılaştırıcısı, ama v0.5'i şişirir." **Çözüm:** K-40 v0.6 (müşteri kuralı: gömülü / açık kitap / hibrit; komisyon yalnız beyan).
Soru **S-20**.

### Tur 4 — İnsan ve kontrol: "her şeyi görmek" ↔ "gözetim yok"

**Kemal Aydın (E):** "Sıralama tablosu isterim; kişi bazında 'AI ne kadar zaman kazandırdı' isterim; kart beklerse otomatik onay
isterim; bir de ayrılma riski skoru."
**Dr. Nesrin Kaya (E):** "Sıralama üç kişilik ekipte motivasyon değil utanç üretir, bilgi paylaşımı durur, hedef 7 durur.
Kişi bazlı zaman kazancı kadro kararına dönüşür; insanlar AI taslağını düzeltmeden gönderir, hedef 2 bozulur."
**Av. Murat Demir (E):** "Ayrılma riski skoru, insan hakkında aleyhe otomatik çıkarımdır; KVKK m.11 ve AI kapalı listenin ruhu
[Doğrulanmalı]. Otomatik onay ana çatı 5'i deler."
**Nesrin Aydemir (A):** "Ama Q7 ekip performansı raporu ürün sahibinin kararı; geri alamayız."
**Moderatör:** Q7 korunur; panel ona **bağlam** ekler. **Tolga Er (E, satışçı):** "Ben zor ilaç müşterilerini alıyorum, %30
kazanırım; Ece KOBİ'lerde %70. Bağlamsız tablo beni kötü gösterir." **Burak Tunç:** "Kazanma oranı segment içinde ve ciro
ağırlıklı gösterilsin." **Selin Ertürk (E):** "Ve 'karar bekleme süresi' ayrı satır olsun; benim gecikmem ekibe yazılmasın.
İlk kez kendi darboğazımı göreceğim."

**Çözüm:** K-27 adil metrik çerçevesi (Benim panom, segment/ciro bağlamı, karar ve müşteri bekleme süresi ayrı satır, append-only
itiraz notu, "otomatik yaptırım dayanağı değildir" ibaresi, AI düzeltmesi kişi metriği değil AI kalite metriği) + K-28 (çalışan
profilleme AI yasak listesine; "Sistem neyi ölçer / ölçmez" sayfası). Ayrılma riski skoru yerine **olay bazlı** güvenlik anomalisi
("bu hesap 15 dakikada 230 müşteri kaydı açtı"). Zaman aşımında otomatik onay reddedildi; yerine **meşgul vekâleti** (K-29):
son tarihli kart N saat yanıtsızsa önce yöneticiye kritik bildirim, sonra vekile — vekil de Face ID kullanır. Sorular: **S-10**
(sıralama ve kişi bazlı zaman kazancı), **S-13** (meşgul vekâleti varsayılanı).

**Ekran süresi telemetrisi.** **Ahmet Sezer (D):** "Saha ekranlarında süre ölçüp haftalık rapora 'sahada en yavaş 3 iş'i
koyalım." **Dr. Nesrin Kaya:** "Ekran ve aktif süre takibi yok dedik." **Ahmet Sezer:** "Kişiyi değil ekranı ölçüyorum." **BG (F):**
"O zaman kişi kimliği olmadan, ekran/iş türü bazında toplulaştırılmış ve en az 5 kullanıcılı gruplarda." **Çözüm:** K-25'e
anonim, toplulaştırılmış UX telemetrisi; kişi bazında yok.

**Prim.** **Murat Kılıç (A):** "Primimi gerçek zamanlı görüyorsam mesajı iletmeye de razıyım." **Aylin Özgür (A, CRM):** "Benimsemenin
anahtarı bu." **Av. Murat Demir:** "Prim iş sözleşmesi ve bordro konusu; sistemdeki 'tahmini prim' bir taahhüt gibi okunabilir
[Doğrulanmalı]." **Nermin Aksoy:** "Prim gerçekleşen kâr ve tahsilat şartına bağlı olmalı; formülü finans onaylar." **Çözüm:**
aşamalı — v0.5'te ilişki sahibi + ilişki emeği (getirilen/sürdürülen ciro ve gerçekleşen kâr) satışçının kendi panosunda; v0.6'da
`rules` tabanlı tahmini prim, İK/hukuk görüşünden sonra. Soru **S-11**.

**Karşılıklılık skoru kime?** **Hande Yılmaz (B):** "Siz bizi puanlıyorsunuz; biz de acentayı. Opsiyonu son gün bırakan, ödemeyi 45
gün geciktiren acentaya blok vermem." **Kerem Özbek (B):** "'Tedarikçiye sözümüzü tutma' ekip performansına girsin." **Dr. Nesrin
Kaya:** "Opsiyonu kaçıran çoğu zaman satışçı değil, müşterinin geç kararı ya da yöneticinin bekleyen onayı." **Çözüm:** K-26
karşılıklılık göstergesi **acenta ve proje düzeyinde**; kişi raporunda yalnız bağlamlı bilgi satırı, sıralamaya girmez. Soru **S-12**.

**Devir-teslim.** **Tolga Er (E):** "Giderken iz bırakan ama adı silinmeyen biri olarak giderim; denetim izi beni de koruyorsa."
**Aylin Özgür (A):** "Devir paketi: açık projeler, opsiyonlar, verilmiş ama yazılmamış sözler, müşteri tercihleri." **Çözüm:**
A-K15 + E-K1/K2/K3 birleşti: K-05 (veriden devir paketi, devralanın "okudum" takibi, planlı/acil erişim kapatma, ayrılış modu;
irtibat değişikliği taslağı devralanın adresinden) + K-04 (ilişki sahibi + zorunlu yedek irtibat). AI destekli "bilgi aktarım
görüşmesi" v0.6.

### Tur 5 — Saha ve veri: çevrimdışı ↔ KVKK, PCO, uçak, transfer, ses

**Murat Kılınç (D):** "Çevrimdışı tam uygulama istiyorum." **Ahmet Sezer (D):** "Sahadaki işin %80'i okuma. Okumayı ucuza
alalım, yazmayı mevcut kuyrukla çözelim; tam senkron ayrı bir yazılım projesidir." **Nilay Karaca (D, müşteri):** "Hostesin
telefonunda çalışanlarımın telefon ve oda numaraları şifresiz durursa hukuk birimim beni sorgular." **BG (F):** "Şifreli, cihaza
bağlı, rol bazlı (hostes yalnız kendi otobüsü), uzaktan iptal, etkinlik bitince geçersiz. Pasaport, doğum tarihi, sağlık yok."
**Av. Murat Demir:** "Telefon numarasının pakette olması kriz yoklaması için meşru olabilir, ama aydınlatma metninde yer almalı
[Doğrulanmalı]." **Hakan Öztürk (D):** "Kriz gecesi ilk kesilen internettir; paketin önceden inmiş olması hayati." **Çözüm:**
K-24 (salt okuma "günün paketi" + mevcut yazma kuyruğunun olay/yoklama/not ile genişlemesi; **onay gerektiren hiçbir şey
çevrimdışı yapılmaz**; limit üstü ekstra "sözlü onay — teyit bekliyor" kartına düşer, yönetici Face ID ile teyit eder — K-08).
Kriz anında Face ID atlanması reddedildi; yerine kriz vekili + kriz harcama tavanı `rules`'ta (K-23). Soru **S-15**.

**PCO hedef pazar mı?** **Dr. Elif Tunç (D):** "Kayıt, yaka kartı, abstract olmadan kongre organizatörüne satamazsınız."
**Selim Erkan (A):** "Doğru; ama kayıt modülünü yazmak yerine entegrasyon." **Ahmet Sezer:** "Tam kayıt platformu altı aylık iş."
**SA (F):** "İlk tasarım ortağı grubunda 1–2 PCO yeterli." **Çözüm:** v0.5'te asgari katılımcı nesnesi (K-22: içe aktarım, VIP,
diyet, rıza, üçüncü kişiye yalnız gerekli alanla süreli aktarım); v0.6'da basit kayıt formu + yaka kartı dışa aktarımı + kayıt
platformu entegrasyon araştırması (K-47). Soru **S-04**.

**Uçak.** **Levent Kaya (B):** "Biletin hatası geri alınmaz. GDS istemiyorum; PNR, ücret kuralı özeti, TKT time limit ve isim
listesi son tarihi alanları ve bunların karar kartı istiyorum. Butik acentanın çoğu zaten konsolidatörden alıyor." **YZ (F):**
"PNR metni isim içerir; modele gitmeden maskelenmeli. İsim yazım kontrolü (Şükrü ↔ SUKRU) deterministik, ICAO
transliterasyonuyla." **Çözüm:** K-21 takip katmanı v0.5 (bilet kesme yok, AI bilet kesemez — ana çatı 6), PNR metni ayıklama
v0.6. Soru **S-16**.

**Transfer ne zaman?** Üç komite transferi P1 istedi. **EM (F):** "Transfer manifesti uçuş verisine ve program verisine
dayanır; ikisi v0.5'te yeni geliyor. Önce temel, sonra üstü." **Murat Kılınç:** "Rötar yüzünden kaybettiğimiz bekleme parası
gerçek." **Moderatör:** Karar: transfer çekirdeği **v0.6'nın ilk işi** (K-38); v0.5'te uçuş alanları (K-21), program (K-09),
katılımcı (K-22) ve rötarda tek dokunuş deseni (K-01) hazır olacak. Gerekçe bağımlılık, önem değil.

**Ses.** **BG (F):** "Tarayıcı Web Speech sesi üçüncü taraf hizmete gönderebilir; varsayılan kapalı olmalı." **Murat Kılınç ve
BA:** "Sahada ve arabada yazmıyoruz, sesli not atıyoruz." **Çözüm:** kiracı ayarı, varsayılan kapalı, ilk kurulumda yönetici
bilinçli açar (uyarıyla); sunucu tarafı STT v0.6 (K-32). Sesle onay hiçbir koşulda yok.

### Tur 6 — Kapsam, SaaS ve AI maliyeti: ne v0.5, ne sonra?

**ÜM (F):** "Logo, Netsis, Paraşüt API, Gmail push, Embedded Signup, bedbank…" **EM (F):** "Her biri 4–10 hafta ve dış onay
bekler. Canlı test edilmemiş üç entegrasyonumuz var. Kural: yeni entegrasyon yazmadan önce mevcutları canlıda doğrula; Google
OAuth doğrulaması ve WhatsApp başvuruları takvim riski, hemen başlatılmalı." **Herkes kabul (K-31).**

**AI maliyeti.** **FİM (F):** "Proje başı maliyet?" **YZ (F):** "Kaba tahmin birkaç EUR ile birkaç on EUR; büyük kongrede daha
fazla [Doğrulanmalı — pilot ölçümü]." **BA:** "Kredi bitince sistem duracak mı?" **YZ:** "Durmamalı. Deterministik mock ve kural
motoru var; AI kapalıyken akış, onay, belge ve hesap çalışır, yalnız okuma elle yapılır." **Çözüm:** K-33 (AI'sız mod + kiracı ×
işlem × token × maliyet ölçümü; kredi aşımında elle moda iner). Fiyat ölçütü: **S-21** (panel: kullanıcı bandı + AI kredisi;
proje başı ölçüt kurum hafızasını deler).

**Benchmark ve tedarikçi portalı.** **Selim Erkan (A) ve SA (F):** "200 acentanın otel teklifleri birleşirse sektör fiyat endeksi."
**BG (F):** "Kiracı izolasyonunu (ana çatı 2) ve tedarikçiyle gizli fiyat anlaşmalarını ihlal eder." **Serap Aydın (B):**
"Tedarikçiler arası fiyat bilgisi taşımak rekabet hukuku açısından da riskli [Doğrulanmalı: 4054]." **Hande Yılmaz:** "Her acentaya
aynı belgeleri ayrı ayrı yüklüyorum; tek portal isterim." **Çözüm:** üçü de **ANA ÇATI ÇELİŞKİSİ (2)**; v0.5'te yalnız hukuk görüşü,
uygulama yok (K-54). Soru **S-24**.

**Kesim turu.** Moderatör komite P1'lerini (≈ 140 geliştirici-haftası) okudu ve dört ölçütle kesti: (1) para kaybını veya
geri alınamaz hatayı önlüyor mu; (2) tasarım ortaklarına açılmanın ön koşulu mu; (3) başka bir v0.5 maddesinin bağımlılığı mı;
(4) `[Doğrulanmalı]` teyidi tamamlanmış mı. Bu ölçütle **v0.6'ya kayanlar:** transfer (bağımlılık), CRM-lite ve açık kitap
(ticari değer yüksek ama para kaybı önlemiyor), vergi doğruluğu dalgası (teyit bekliyor), EN belgeler (Aşama A Türkiye pazarı),
self-servis dışa aktarım ve destek erişimi (ticari açılıştan önce zorunlu, tasarım ortaklarında elle yönetilir), onboarding
sihirbazı (ilk ortaklar elle kurulur). **Nesrin Aydemir** CRM-lite'ın kaymasına şerh düştü; **Nermin Aksoy** vergi dalgasının
kaymasını "teyit v0.5 içinde tamamlanırsa" şartıyla kabul etti; **Murat Kılınç** transferin kaymasını "v0.6'nın ilk işi"
yazılması şartıyla kabul etti. Son oylama: v0.5 kapsamı 27 kabul, 2 şerh, 0 ret.

**Kapanış — Hande Yılmaz (otel):** "Bu sistem acentanın opsiyonu zamanında bırakmasını, release'e uymasını ve ödemeyi takvimde
yapmasını sağlarsa size AI'den daha çok fiyat kazandırır." **BA (F):** "'AI'sız da çalışır', 'veri senindir', 'ilk iki projeyi
birlikte yapıyoruz' — bunları sözleşmeye yazarsanız denerim."

---

## Hedef bazında değerlendirme

| # | Hedef | Bugün sistemde | v0.5 ile gelecek | Ölçüt / KPI (pilotta ölçülür, eşikler `rules`) |
|---|---|---|---|---|
| 1 | Takibi kolaylaştırmak | Karar kutusu, RFQ 24/48 sa takip, günlük özet, sabah/akşam bildirim | Opsiyon, release, TKT time limit, isim listesi, ödeme planı vadesi kartları; program verisi; karar yaşlanma göstergesi; çevrimdışı günün paketi (K-09, K-12, K-13, K-16, K-21, K-24, K-29) | Kaçırılan son tarih sayısı (opsiyon/release/TKT/ödeme) = 0; kart medyan bekleme süresi; saha tek işlem ≤ 3 dokunuş |
| 2 | Hataları minimuma indirmek | Eski belge gönderilemez, DB guard'ları, normalizasyon, sözleşme–teklif farkı | Rooming revizyon farkı, değişiklik yayını (deterministik alıcı listesi), ICAO isim eşleştirme, IBAN değişikliği koruması, mükerrer ödeme kontrolü, kanal fiyatı kanıtı (K-08, K-10, K-14, K-18, K-21) | Müşteri/tedarikçiye giden hatalı belge sayısı; "unutulan alıcı" olayı = 0; hatalı ödeme = 0; isim uyuşmazlığı yakalama oranı |
| 3 | Müşteriye maksimum hızda dönüş | AI talep ayıklama, eksik bilgi sorusu, RFQ tek tık, hızlı revizyon (Q9) | İlk yanıt SLA sayacı, acil teklif modu, kontratlı kalemde RFQ'suz fiyat, tek dokunuş + nöbetçi (K-01, K-02, K-11) | İlk yanıt ≤ 2 iş saati (%90); talep → teklif ≤ 2 iş günü (PRD hedefi); kontratla fiyatlanan kalem payı |
| 4 | Tedarikçilerle güçlü bağ | Giriş gerektirmeyen link, tedarikçi skoru, pazarlıkta rakip fiyatı yasağı | Opsiyonu zamanında bırakma/uzatma, release taslağı, ödeme planına uyum, karşılıklılık göstergesi, "son 10 RFQ'da 0 iş" uyarısı, ilişki seviyesine göre tur sınırı (K-12, K-13, K-16, K-26) | Opsiyonu bitmeden bildirme oranı ≥ %95; ödeme vadesi ort. sapma ≤ 2 gün; tedarikçi başına boş RFQ oranı |
| 5 | Müşteriye güvenilir irtibat | Kişinin kendi adresinden gönderim, müşteri onay linki | Müşteri proje portalı + irtibat kartı (sorumlu, yedek, nöbetçi, acil hat), ilişki sahibi + zorunlu yedek, devirde irtibat taslağı (K-03, K-04, K-05) | Portali olan aktif proje %; anket "irtibat" puanı; sorumlu değişiminde müşteri bekleme süresi |
| 6 | Kontrol kişide değil sistemde | Karar kutusu, kişi bazlı yetki, vekâlet, Face ID, kural önerisi | Kapora önce, ödeme güvenliği/görev ayrılığı, meşgul vekâleti, kriz vekili, karar bekleme süresi satırı, sözlü onay teyit kartı (K-08, K-16, K-18, K-23, K-27, K-29) | Sistem dışı verilen onay (kaynaksız değişiklik) sayısı; istisna oranı ve gerekçe kapsaması %100; yönetici karar bekleme medyanı |
| 7 | Kurum hafızası kalıcı | Silinmez kayıt + audit, fiyat geçmişi, ilk veri yükü, gelen e-posta/WhatsApp projeye bağlı | Devir-teslim + erişim kapatma, kanal politikası ("projeye ilet"), kontrat fiyatı, yazışma soru takip listesi, saha notu kartı (K-05, K-06, K-07, K-11) | Devir paketi "okundu" tamamlanma %; kaynağı sistemde olan taahhüt oranı; ayrılış sonrası kaybedilen açık iş = 0 |
| 8 | Fiyat değişkenliğini azaltmak | Fiyat geçmişi medyanı, manuel OTA fiyatı, pazarlık taslağı | Kontrat fiyatı çıpa; EUR'ya o günün kuruyla, sezon/kapsam kovalı, min. örneklemli, P25–P75 kıyas; kanal fiyatı kanıtı; fiyat kilidi ve kur politikası (K-11, K-14, K-15) | Teklif → konfirmasyon → fatura fiyat sapması %; "bilmiyorum" yerine kontrat/aralıkla fiyatlanan kalem payı |
| 9 | Yazışmaların tutarlı ve eksiksiz cevaplanması | "Bu projeye sor" (kısmi), sözleşme–teklif alan farkı | Her iddia kaynağa bağlı cevap, kaynak yoksa "bilmiyorum", çelişki gösterimi; müşteri sorularının soru takip listesi (K-07); PDF/görsel PII maskeleme (K-32) | Gönderim öncesi "cevaplanmamış soru" = 0; kaynaksız cümle oranı = 0; çelişki yakalama sayısı |
| 10 | Hesap hatası yok, kâr maksimum, gelir-gider kontrolde | Marj/markup ayrı, markup kademeleri, gerçekleşen kâr EUR + TL (Q5), banka eşleştirme, Mikro Excel | Attrition/release ceza hesabı (domain), ödeme planı + nakit akış, kapora önce, üç kolon kârlılık + sapma nedenleri + banka kur marjı, kur politikası (K-12, K-15, K-16, K-17, K-19) | Planlı → gerçekleşen marj kaybı (bugünkü örnek ≈ 3,8 puan) azalışı; ödenen attrition cezası EUR; faturalanmamış ekstra/fark sayısı |

---

## Kararlar

Efor: **S** ≤ 2 hafta · **M** 2–6 hafta · **L** 6+ hafta (tek küçük ekip, kaba; Komite F tanımı). Öncelik P1 = v0.5 zorunlu.
"v0.5-B" = v0.5'in ikinci yarısı; ekip 4 kişiyle sınırlı kalırsa v0.6'ya kayabilir. Tüm eşik ve süreler `rules` tablosunda,
`DEFAULT_RULES` temkinli varsayılan; tüm yeni tablolar `apply_standard_policies` + `apply_tenant_foreign_keys`; sözleşme
(`api.ts`) değişiklikleri eklemeli. Komite kodları: A Ticari, B Tedarik, C Finans, D Operasyon, E Yönetim–İnsan, F Ürün–SaaS.

### v0.5 (zorunlu)

| # | Karar (birleştirilmiş) | Komiteler | Hedef | Öncelik | Efor | Sürüm | Ana çatı uyumu |
|---|---|---|---|---|---|---|---|
| K-01 | **Hızlı onay deseni (dış mesaj):** AI taslak → sorumluya push → tek dokunuş → insanın adresinden; toplu onay kartı (ör. "bugün 5 tahsilat hatırlatması", her mesaj ayrı audit); nöbetçi + N dk sonra vekile/yöneticiye eskalasyon; web formunda statik "alındı" ekranı (mesaj değil). Tahsilat, kriz, rötar, release/opsiyon bırakma `NEVER_AUTO`. | A, B, C, D, F | 3, 5, 6 | P1 | S | v0.5 | 6 korunur (S-01) |
| K-02 | **İlk yanıt SLA sayacı + acil teklif modu:** iş saatiyle ölçülen SLA (vars. 2 sa), süre dolarken kart; "acil" projede takip süreleri kuraldan (ör. 4/8 sa); talep büyüklüğüne göre kademeli RFQ hatırlatması; müşteri bazında ilk yanıt/teklif süresi raporu. | A, B, E | 3, 1 | P1 | S | v0.5 | 8 |
| K-03 | **Müşteri proje portalı + irtibat kartı:** mevcut giriş gerektirmeyen linkin genişlemesi; sorumlu + yedek + vardiyaya göre nöbetçi + acil hat; güncel belgeler (Rev.n, sözleşme, program), eski belge "güncelleniyor"; açık onaylar; değişiklik geçmişi; olay özeti (PII'sız). | A, D, E | 5, 3, 9 | P1 | M | v0.5 | 4, 6 |
| K-04 | **İlişki sahibi + zorunlu yedek irtibat:** müşteri kaydında iki kişi (küçük ekipte kuralla gevşer); yedek pasif, izin/devirde aktif; ilişki emeği (ciro, gerçekleşen kâr) kişinin panosunda; ad geçmişte kalır. | E, A | 5, 7 | P1 | S | v0.5 | 3 |
| K-05 | **Devir-teslim + erişim kapatma + ayrılış modu:** admin başlatır; veriden devir paketi (açık projeler/kartlar, opsiyonlar, bekleyen yanıtlar, insanın doğruladığı taahhütler, irtibatlar); devralan "okudum" takibi; planlı/acil kapatma (oturum, WebAuthn, OAuth jetonu iptali, vekâlet sonu, kartların aktarımı; acilde Face ID + gerekçe); ihbar süresinde görünür, orantılı kısıt. İrtibat değişikliği taslağı devralanın adresinden. | E, A | 7, 6 | P1 | M | v0.5 | 3, 5, 6 |
| K-06 | **Kanal politikası:** yalnız kurumsal hesaplar bağlanır (kişisel alan adı vars. engelli, admin istisnası S-09); kurumsal kutuda yalnız proje/müşteri eşleşen iletiler; kişisel kanaldan "projeye ilet" + "kişisel kanal, çalışan iletti" etiketi; "bağlayıcı taahhüt N saatte projeye işlenir" acenta kuralı; kurumsal WhatsApp hattı önerilir. | A, E, D | 7, 9 | P1 | S–M | v0.5 | 6, 9 |
| K-07 | **Yazışma analizi — kaynaklı cevap + soru takip listesi:** "Bu projeye sor"da her iddia kaynağa (e-posta, madde, revizyon) bağlı; kaynak yoksa "bilmiyorum"; çelişki gösterilir; müşteri sorularının listesi cevaplandı / cevaplanmadı / çelişkili; cevap taslağı insan onaylı. | F, D, A | 9, 3, 7 | P1 | M | v0.5 | 6, 9 (maskeli metin) |
| K-08 | **Değişiklik ve taahhüt kaydı + değişiklik yayını:** sözlü/yazılı her taahhüt ("40 kişi daha olur") değişiklik kaydı açar ve mevcut değişiklik akışını tetikler; limit üstü sözlü onay "teyit bekliyor" kartı (yönetici Face ID); program/rooming değişikliğinde etkilenen tedarikçi/rehber/müşteri listesi deterministik, tek "yayınla" onayı, alıcılar görünür. | A, D | 2, 6, 10 | P1 | M | v0.5 | 4, 5, 6 |
| K-09 | **Program / run-of-show yapılandırılmış veri:** gün → oturum satırı (saat, mekân, kalem, grup, sorumlu); müşteri programı, saha föyü, manifest ve portal bu veriden; değişince "eski". | D | 1, 2, 5 | P1 | M | v0.5 | 4 |
| K-10 | **Rooming revizyon yönetimi:** her yükleme Rev.n; fark ("3 yeni, 2 iptal, 1 tip değişikliği"); otele fark + güncel tam liste taslağı (format tedarikçi ayarı), insan onaylı; iptal = durum; cut-off sonrası ücret uyarısı; oda-gece toplamı attrition eşiğine yaklaşınca K-12 kartı. | D, B | 1, 2, 10 | P1 | M | v0.5 | 3, 9 |
| K-11 | **Kontrat fiyatı çekirdeği:** tedarikçi × geçerlilik × sezon × oda tipi/pansiyon; birim fiyat listesi (AV, F&B); blackout; orijinal para birimi + EUR; talepte önce kontrat kontrolü; kıyasta çıpa kontrat. (Dinamik BAR−%x, hacim taahhüdü ilerlemesi v0.6.) | B, A | 8, 10, 3 | P1 | M | v0.5 | 7, 8 |
| K-12 | **Allotment çekirdeği:** blok, release kademeleri, cut-off, attrition toleransı, isimsiz pickup, ücretsiz oda politikası; **attrition/release ceza hesabı `packages/domain`'de saf fonksiyon**; release tarihinden T-n gün önce tahmini ceza tutarlı "release et / tut" kartı; release bildirimi taslak + insan onayı. AI yalnız kontrat maddesini ayıklar, insan doğrular. | B, D, C | 10, 2, 4 | P1 | M | v0.5 | 1, 6, 8 |
| K-13 | **Opsiyon yönetimi:** opsiyon sırası (1./2. opsiyon; 2. opsiyon teklifte uyarıyla); uzatma talebi akışı; T-3 "Uzat / Bırak / Konfirme et" kartı; uzatmada müşteri teklifinin opsiyonu güncellenir ve teklif "eski" olur. | B, E | 4, 2, 3 | P1 | S–M | v0.5 | 4, 6 |
| K-14 | **Fiyat kıyası düzeltmesi + kanal fiyatı kanıtı + AV gizli maliyetler:** geçmiş fiyat EUR'ya o günün kuruyla; şehir × segment × sezon × hafta içi/sonu kovası; kapsam etiketi; min. örneklem (vars. 5, altı "bilmiyorum"); medyan yerine P25–P75 + n; kanal fiyatında ekran görüntüsü + zaman damgası + koşul alanları zorunlu, eksikse avantaj % hesaplanmaz, 72 sa "bayat"; scraping yok; uçuşa OTA tablosu uygulanmaz; gizli maliyet listesine AV kalemleri (in-house AV zorunluluğu, harici AV giriş ücreti, kVA, yük asansörü, kurulum gecesi, rigging). | B, A | 8, 10, 2 | P1 | M | v0.5 | 8 |
| K-15 | **Teklif kur politikası + fiyat kilidi:** teklif/gösterim para birimi; zorunlu kur politikası (EUR / TL + ödeme günü kuru maddesi / TL sabit + tampon %); tedarikçi fiyatında "sabit şu tarihe kadar", TL sabit/endeksli, kontrattaki kur esası; tampon marj hesabında ayrı satır; kur hareketiyle hedef marj altına düşen projede kart. (Açık pozisyon raporu v0.6.) | A, B, C | 10, 8 | P1 | M | v0.5 | 7 (iç EUR değişmez) |
| K-16 | **Ödeme planı nesnesi + "kapora önce":** müşteri tahsilat ve tedarikçi ödeme planı (sözleşmeden AI ayıklar, insan onaylar; taksit, para birimi, vade, bağlı olay); durumlar; T-5 ödeme talebi kartı (mevcut Face ID akışı); gecikme kartı; kapora tahsil edilmeden ön ödeme talebinde kırmızı kart + proje net nakit pozisyonu, vars. uyar + gerekçe + Face ID istisna, acenta "blok" seçebilir; haftalık istisna listesi. | B, C | 10, 4, 6 | P1 | M | v0.5 | 5, 6, 8 |
| K-17 | **Temel 13 haftalık nakit akış görünümü:** para birimi bazında, ödeme planları + açık faturalar + onaylı ödeme talepleri + elle girilen genel giderler. (Senaryolar v0.6.) | C | 10, 6 | P1 | S | v0.5-B | 7 |
| K-18 | **Ödeme güvenliği + toplu onay:** görev ayrılığı (talep eden onaylayamaz; tek kişilik acentada "tek imzalı" raporlanır); IBAN değişikliği beklemede + ikinci kanal doğrulama görevi + Face ID + ilk ödemede "YENİ IBAN"; mükerrer ödeme kontrolü; toplu banka ödeme dosyası yalnız onaylılardan; tek Face ID ile seçili kartların toplu onayı (toplam ekranda, her kart ayrı audit). | C, F | 2, 6 | P1 | M | v0.5 | 5, 6 |
| K-19 | **Kârlılık üç kolon + sapma nedenleri:** teklif – sözleşme – gerçekleşen aynı kalem kimliğiyle; sapma kategorileri (kur, saha ekstrası, iptal/no-show, fatura farkı, banka/POS masrafı, yansıtılamayan fark); Q5'in somutlaştırılması: "banka kur marjı" satırı, fiili kur yoksa "tahmini". | C | 10, 7 | P1 | S | v0.5 | 7 (Q5 ile uyumlu) |
| K-20 | **Muhasebe aktarımında doğrulama:** Mikro sütunlarının gerçek Mikro kurulumunda doğrulanması; VKN/TCKN ile cari eşleme ve eşleşmeyen carinin aktarımdan önce listelenmesi; çift aktarım engeli. (Kanonik fiş + ikinci program v0.6.) | C, F | 10, 2 | P1 | S | v0.5 | 1 (eklemeli) |
| K-21 | **Uçuş takip katmanı + isim eşleştirme:** PNR, havayolu, grup/bireysel, ücret kuralı özeti, depozito, TKT time limit, isim listesi son tarihi; T-24s/T-4s ve T-7/T-3/T-1 kartları, tahmini kayıp; AI bilet kesmez, insan keser, bilet no işlenir; rooming ↔ pasaport adı deterministik ICAO eşleştirme (model yok). | B, F | 2, 10, 1 | P1 | S–M | v0.5-B | 6, 9 |
| K-22 | **Katılımcı nesnesi (asgari):** misafir PII katmanında; Excel/CSV içe aktarım (AI yalnız kolon eşleme önerir, isimler maskeli); etiketler (VIP, grup, diyet); VIP uyarısı rooming/manifest/oturmada; diyet/alerji deterministik sayım (modele PII gitmez); sağlık için ayrı rıza; üçüncü kişiye (matbaa, yaka kartı) yalnız gerekli alanla, süreli link/şifreli dosya, kayıtlı. | D, E, B | 2, 7, 1 | P1 | M | v0.5 | 2, 9 |
| K-23 | **Olay kaydı + yoklama + kriz paketi:** olay türü, sorumlu, zaman, kapanış (çevrimdışı); otobüs/grup yoklaması; proje "Kriz" ekranı; `rules`'ta önceden onaylı kriz şablonları, tek dokunuş yayın; kriz vekili + kriz harcama tavanı, vekil kendi Face ID'siyle; kontrol listesinde "kriz paketi hazır". | D | 2, 5, 6 | P1 | S–M | v0.5 | 5, 6, 8 |
| K-24 | **Çevrimdışı "günün paketi" (salt okuma):** program, rol bazlı manifest/oda listesi, acil numaralar, kriz şablonları; şifreli, cihaza bağlı, asgari PII (S-15), uzaktan iptal, etkinlik sonunda geçersiz; mevcut yazma kuyruğu olay/not/yoklama/geldi-gelmedi ile genişler; sunucu + cihaz zamanı audit'e; çakışmada üzerine yazma yok; **onay gerektiren hiçbir şey çevrimdışı yapılmaz**. | D, F | 1, 2, 5 | P1 | M | v0.5 | 3, 5, 9 |
| K-25 | **Saha kabul kriterleri:** sahaya giden her ekran tek elle ≤ 3 dokunuş; tek oda değişikliği ≤ 45 sn; saha ekstra limitini tutar değil durum olarak görür (içinde/yakın/aşıldı); rehber/hostes kişi tipi tedarikçi alanları (dil, lisans, belge geçerlilik tarihi — insan doğrular) + süre uyarısı; anonim, toplulaştırılmış UX telemetrisi (kişi bazlı değil); sesli/yazılı saha notu insan onayıyla tedarikçi/mekân kartına (kurum hafızası, sonraki projede kontrol listesi önerisi). | D, E | 1, 2 | P1 | S | v0.5 | 6 (AI belge doğrulayamaz) |
| K-26 | **Karşılıklılık göstergesi ("biz iyi müşteri miyiz?"):** opsiyonu bitmeden bildirme, release'e uyum, ödeme vadesi sapması, konfirmasyon sonrası iptal, tedarikçi başına boş RFQ; kısa listede "son 10 RFQ'da 0 iş" uyarısı; tedarikçi ilişki seviyesi (Stratejik/Tercihli/İşlemsel) ve yazılı pazarlık tur sınırı (vars. 1/2/3). Acenta ve proje düzeyinde. | B | 4, 8 | P1 | S | v0.5-B | 8 |
| K-27 | **Adil metrik çerçevesi:** Q7 raporu korunur; kazanma oranı segment içinde ve ciro ağırlıklı; karar bekleme ve müşteri bekleme süresi ayrı satır; "Benim panom"; append-only itiraz/açıklama notu; "insan değerlendirmesinin girdisidir, otomatik yaptırım dayanağı değildir"; AI taslak düzeltmesi kişi metriği değil AI kalite metriği; akran sıralaması vars. kapalı (S-10). | E, A, B | 6, 2, 10 | P1 | S–M | v0.5 | 3 |
| K-28 | **Gözetim sınırı + çalışan profilleme yasağı:** ekran, tuş, aktif süre, mesai dışı çevrim içi, sürekli konum toplanmaz; "Sistem neyi ölçer / ölçmez" sayfası; AI çalışanın ayrılma riski, sadakati, kişiliği hakkında çıkarım/skor üretemez (`ai-authority.ts`'e eklemeli); güvenlik anomalisi olay bazlı ve kural tablolu; toplu dışa aktarım yalnız admin, audit'li. | E, D | 6, 7 | P1 | S | v0.5 | 6, 9 (eklemeli) |
| K-29 | **Bildirim hijyeni + meşgul vekâleti:** kişi bazlı sessiz saat (vars. açık), "kritik" tanımı `rules`'ta, nöbet planı; son tarihli kart N saat yanıtsızsa önce yöneticiye kritik bildirim, sonra vekile (vekil Face ID); karar kartı yaşlanma göstergesi; **zaman aşımında otomatik onay yok**. (Etkinlik modu, push bütçesi v0.6.) | E, A | 1, 3, 6 | P1 | S–M | v0.5-B | 5 |
| K-30 | **SaaS açılış güvenliği:** platform süreciyle kiracı provizyonu (`apply_standard_policies` kalıbı); yönetici/finans rollerinde MFA (passkey öncelikli); HttpOnly yenileme belirteci; kiracı önekli şifreli nesne deposu; bağımsız sızma testi canlıdan önce; ISO 27001 yol haritası. (SSO v0.6.) | F, E | 6, 7 | P1 | L | v0.5 | 2 |
| K-31 | **Mevcut entegrasyonları canlıda doğrula:** Gmail/Graph gönderim + gelen posta (watch/abonelik), Google OAuth doğrulama başvurusu, WhatsApp tek numara canlı + Embedded Signup/teknoloji sağlayıcı başvurusu, SMS sağlayıcı seçimi; başvurular **hemen** (dış bekleme). | F | 3, 5 | P1 | M | v0.5 | 6 |
| K-32 | **PDF/görsel PII maskeleme + ses:** belge modele gitmeden metin çıkarımı + maskeleme; görsel gönderim kiracı kuralı (vars. temkinli); AI sağlayıcı saklama/eğitim koşulları sözleşmeyle teyit; tarayıcı sesli not vars. kapalı + üçüncü taraf uyarısı; sesle onay asla. | F, D | 9 | P1 | M | v0.5 | 9 |
| K-33 | **"AI'sız da çalışır" + AI kullanım ölçümü:** AI kapalı/kredi bitmiş/kesintide tüm akış, onay, belge ve hesap çalışır (ayıklama elle); arayüzde durum göstergesi; kiracı × işlem × model × token × tahmini maliyet ölçümü; kredi aşımında elle moda iner, sistem durmaz; pilotta proje başı gerçek maliyet raporu. | F | 2, 6, 10 | P1 | M | v0.5 | 6 (`aiGate`) |
| K-34 | **Gerçek doğruluk ölçümü:** pilot düzeltmelerinden maskeli gerçek set (alan türü bazlı), Claude ile ölçüm, alan türü eşiklerinin `rules`'a yazılması, CI gerileme kapısı; ölçülmemiş doğruluk rakamı satış materyalinde yasak. | F | 2, 9 | P1 | S–M | v0.5-B | 8 |
| K-35 | **Paketleme altyapısı + gölge mod:** abonelik hakları `tenant_entitlements` tablosunda (RLS'li, platform yazar, audit'li — `rules` değil); çekirdek 0–8 her pakette tam; butik için "sade mod" görünümü; ilk 2–4 hafta "gölge mod" (otomasyon terfisi kapalı, "AI önerdi / siz yaptınız" karşılaştırması). | F, A, E | 1, 6 | P1 | S–M | v0.5-B | 4, 8 |
| K-36 | **KVKK satış paketi (kod dışı, hukuk):** VİS şablonu, alt işleyen listesi, yurt dışı aktarım mekanizması, misafir/katılımcı ve **çalışan** aydınlatma metinleri, VERBİS rehberi, DPIA özeti. | F, E, D | 9, 5 | P1 | M (hukuk) | v0.5 (paralel) | 9 |
| K-37 | **Tasarım ortağı programı + pazar doğrulama (kod dışı):** 8–12 karışık profilli ortak (5–6 butik, 2–3 orta, 1–2 DMC/PCO); 10–15 acentayla fiyat görüşmesi; muhasebe programı dağılımı anketi; "kaçak taraması" yalnız ortaklarla denenir. | F, A | tümü | P1 | S | v0.5 (paralel) | — |

**Efor özeti:** v0.5 = 35 ürün kararı + 2 kod dışı çalışma; kabaca 9 S, 8 S–M, 17 M, 1 L ≈ **95–110 geliştirici-haftası**
(5 kişilik ekiple ~6 ay, %20 tampon dahil). 4 kişilik ekipte "v0.5-B" işaretli 6 madde (K-17, K-21, K-26, K-29, K-34, K-35)
v0.6'ya kayar; K-21 kayarsa K-38 transfer de bir sürüm kayar.

### v0.6 (v0.5'ten hemen sonra)

| # | Karar | Komiteler | Hedef | Öncelik | Efor | Neden v0.6 | Ana çatı |
|---|---|---|---|---|---|---|---|
| K-38 | **Transfer operasyon çekirdeği** (v0.6'nın ilk işi): uçuş manifesti → deterministik araç gruplama (kapasite, zaman penceresi, VIP; `rules`) → karşılama listesi → tedarikçi linkinden şoför/plaka; transfer firmasına canlı manifest linki (pull); rötarda saha nöbetçisine push + tek dokunuş şoför bildirimi (K-01); bekleme/gece tarifesi kuralları; faturadaki bekleme ücretinin rötar kaydıyla doğrulanması. Canlı uçuş API'si v0.7. | B, D, F | 2, 1, 10 | P1 | M–L | K-09, K-21, K-22'ye bağımlı | 6, 8, 9 |
| K-39 | **CRM-lite:** talep öncesi "fırsat" durumu (eklemeli), kapanan projeden 9–11 ay sonra tekrar fırsatı kartı, hesap kartı (yıllık ciro/kâr, kazanma oranı, açık fırsatlar); kayıp nedeni taksonomisi; müşteri notlarında "kurumsal tercih" (modele gidebilir) ↔ "kişiye ait hassas not" (şifreli, modele gitmez). | A, F, E | 7, 1, 10 | P1 | M | Para kaybı önlemiyor; K-04 temelini kullanır | 1, 3, 9 |
| K-40 | **Müşteri bazında fiyat modeli:** gömülü markup / açık kitap + yönetim ücreti / hibrit; açık kitapta net alış + ücret + beyan edilen komisyon; kanal fiyatı, avantaj %, pazarlık notları, diğer teklifler **hiçbir modelde** gösterilmez; ücret için de markup ve marj ayrı. | A, C | 10, 9, 5 | P2 | M | Kurumsal paket farklılaştırıcısı; S-20 | 7, 8 |
| K-41 | **Markup öneri boyutları ve revizyon ekonomisi:** `rules`'a isteğe bağlı sezon/segment/lead time boyutları (varsayılan = bugünkü kademe tablosu; AI gerekçeli öneri, yönetici kural olarak kabul eder); "stratejik yatırım" gerekçe kodu + 12 ay sonra yaşam boyu kârlılık raporu; pax bandı fiyatlaması (her bant kendi maliyetinden); revizyonda sabit/değişken maliyet ayrımıyla marj etkisi. | A, B | 10, 3 | P2 | M | Mevcut kural önerisi üreticisini genişletir | 6, 8 |
| K-42 | **Tedarikçi skoru revizyonu ve RFQ nezaketi:** bileşenler (fiyat tutarlılığı, operasyon doğruluğu, fatura doğruluğu, normalize yanıt süresi, esneklik; ağırlıklar `rules`), min. 3 proje, "dış etken" kök nedeni, zaman ağırlıklı (decay), tedarikçi itiraz notu; tek kaynak etiketi; RFQ'da tarih esnekliği/karar tarihi/talep olgunluğu (bütçe alanı vars. kapalı); kaybedilen RFQ'da teşekkür + neden kategorisi taslağı; istenirse nitel, puansız performans özeti taslağı. | B | 4, 8, 2 | P2 | M | K-26 verisi birikince anlamlı | 3, 6 |
| K-43 | **Vergi doğruluğu dalgası:** kalem faturalama modeli (kendi nam ve hesabına / aracılık / masraf yansıtma / yalnız satış; varsayılan kalem türünden, sade modda gizli; sistem önerir, finans onaylar); vergi parametreleri yürürlük tarihli kural; kur farkı motoru; ters belge (iade, fiyat farkı, iptal bedeli); dört kur kavramının (teklif / belge / fiili / değerleme) ayrı saklanması; belge tarihleri; e-Fatura itiraz sayacı; dönem kilidi + düzeltme belgesi (S-23). | C | 10, 2 | P1 | L | `[Doğrulanmalı]` SMMM teyidi v0.5 içinde tamamlanmalı | 3, 4, 8 |
| K-44 | **Muhasebe aktarım çerçevesi:** kanonik fiş + ince adaptör + kiracı hesap planı eşlemesi; genel Excel/CSV; Mikro modele taşınır (mevcut Excel korunur); ikinci profil (Logo/Paraşüt/Luca — anketle); aylık müşavir paketi; MT940 + banka bazlı Excel; e-Fatura entegratöründen otomatik çekme. | C, F | 10, 6, 7 | P1 | L | S-18; anket sonucu | 1, 8 |
| K-45 | **Finans üçüncü halka:** müşteri risk/kredi limiti (vars. uyarı + Face ID; kamu müşteri bayrağı); "nakit ağırlıklı kâr" finansman maliyeti göstergesi (muhasebe kârına karışmaz); avans–masraf–kasa (saha yalnız kendi avansını görür, S-26); finansal kapanış ayrı durum; komisyon mutabakatı genişletmesi (beklenen komisyon, komisyon faturası taslağı, tahsil takibi); nakit akış senaryoları; açık kur pozisyonu raporu. | C | 10, 6 | P2 | M | Ödeme planı verisine bağlı | 5, 7, 8 |
| K-46 | **Dil ve para birimi görünümü:** müşteri belgeleri TR + EN (insan çevirisi şablon, değişkenler veriden), sonra DE/RU; arayüz EN; kiracı bazında TL/USD görüntüleme-raporlama para birimi (S-19). | A, B, C, F | 3, 9, 10 | P1 | M | Aşama B (ticari açılış TR+EN) için | 4, 7 |
| K-47 | **Kongre/PCO kapısı:** basit online kayıt formu (link, rıza), yaka kartı için veri dışa aktarımı (CSV/PDF etiket), PII'sız ortak katılımcı bilgi sayfası, kayıt platformu entegrasyon araştırması (kayıt sayısı → pax → K-08). | D, A, F | 1, 7, 3 | P2 | M | S-04 cevabına bağlı | 9 |
| K-48 | **Uçak/vize/AV ikinci adım:** PNR metni ayıklama (isimler ön işlemde maskeli); vize/sigorta "belge/izin kalemi" (pasaport şifreli, modele kapalı, MRZ model dışı; poliçe takibi, satış değil); teknik rider veriden üretilen belge (değişince eski). | B | 2, 1, 5 | P2 | M | K-21 üzerine | 4, 6, 9 |
| K-49 | **Operasyon ve insan ek paketi:** saha görev föyü + vardiya; etkinlik sonrası rapor (vars. 3 iş günü); ofis destek/lojistik rolü + fiziksel görev (ıslak imza fotoğrafı sözleşmeyi imzalı yapmaz, "kilitle" kartı açar); kurum bilgi kartları; yetki şeffaflığı sayfası; takvimli yetki değerlendirme kartı + çalışan talebi; devirde AI "bilgi aktarım görüşmesi"; taahhüt/karşılanmamış istek listesi; WhatsApp sohbet dışa aktarımı içe alma (maskeli); etkinlik modu ve push bütçesi; çalışan verisi KVKK (özlük/iletişim alanları şifreli, saklama süresi kuralı, süre sonunda takma adlandırma + kripto-silme). | D, E, A | 7, 1, 5 | P2 | M (çoklu S) | Değerli, para kaybı önlemiyor | 3, 5, 6, 9 |
| K-50 | **SaaS ikinci dalga (ticari açılıştan önce zorunlu):** self-servis tam dışa aktarım (JSON + CSV + PDF + ekler + audit + şema) ve "veri acentanındır" sözleşme maddesi; süreli, onaylı destek erişimi (`withTenant`, salt okuma, PII maskeli, audit + bildirim); onboarding sihirbazı + aktivasyon metriği + demo kiracı + "şampiyon kullanıcı" rolü; SSO; link sayfası markalaması; abonelik/faturalama otomasyonu (~10. müşteriden önce); SLA %99,5 + durum sayfası; audit hash zinciri; giden webhook + salt okunur API; sunucu tarafı STT. | F | 7, 5, 6 | P1 | L | Tasarım ortakları elle yönetilir | 2, 3, 5, 6 |

### v0.7 ve sonrası

| # | Karar | Komiteler | Neden sonra | Ana çatı |
|---|---|---|---|---|
| K-51 | Müşteri uyum (compliance) kuralları (kişi başı tavan, yasak mekân, refakatçi; ihlalde karar kartı; katılımcı bazlı "sağlanan değer" raporu) + maliyet merkezi bölüştürme ve PO tutarı takibi | A | Dar segment (ilaç/finans), `[Doğrulanmalı]` TİTCK | 8, 9 |
| K-52 | GDS/NDC, canlı uçuş durumu API'si, bedbank/toptancı fiyatı ("acentanın kendi API hesabı", yalnız okuma), tam allotment (şehir çapında blok, sub-block, housing), tedarikçiyle isimsiz pickup paylaşımı | B, F | Sözleşme/sertifikasyon, L efor | 6, 9 |
| K-53 | Pazarlama (vaka çalışması, İYS, kampanya), insan onaylı entegratör/Paraşüt üzerinden fatura kesimi (S-17), sanal POS linki, teminat mektubu, yazma API'si + "entegrasyon aktörü" rolü + pazaryeri, özel alan adı, native iOS | A, C, F | Ürün değeri kanıtlandıktan sonra | 5, 6 |
| K-54 | Kiracılar arası veri ürünleri (sektör benchmark'ı, fiyat endeksi, tedarikçi tek portalı/belge kasası) — yalnız hukuk görüşü ve ürün sahibi ana çatı kararıyla (S-24) | A, B, F | **ANA ÇATI ÇELİŞKİSİ (2)** | 2 |

### Reddedilenler

| # | Öneri (kimden) | Red gerekçesi | Yerine |
|---|---|---|---|
| R-01 | Zaman aşımında kartın otomatik onaylanması (E, sahip) | Ana çatı 5 | Meşgul vekâleti (K-29) |
| R-02 | Kriz anında Face ID'nin atlanması (D) | Ana çatı 5 | Kriz vekili + tavan (K-23) |
| R-03 | Çevrimdışı onay (limit üstü ekstra) (D) | Ana çatı 5 | Sözlü onay teyit kartı (K-08) |
| R-04 | AI'nın bilet kesmesi, otomatik forward/döviz alımı, banka API'siyle ödeme gönderimi, AI'nın POS linki göndermesi (B, C) | Ana çatı 6 | Kart + insan; yalnız onaylılardan ödeme dosyası (K-18) |
| R-05 | Release/opsiyon bırakmanın otele otomatik iletimi (B) | Ana çatı 6 | T-n kartı + taslak (K-12, K-13) |
| R-06 | Ekran, tuş, aktif süre takibi; ayrılma riski skoru; kişisel hesap/cihaz okuma; ruh hali anketi (E, sahip) | Ana çatı 6 ruhu, 9; ölçülülük | K-28, olay bazlı anomali |
| R-07 | Pasaport görselinin AI ile okunması; alerji/diyetin modelle işlenmesi; yazışmada katılımcı adlarının modele gitmesi (B, D) | Ana çatı 9 | MRZ model dışı, deterministik sayım, maskeleme |
| R-08 | Tedarikçi skorunun, kişisel notun, rooming'deki misafirin "silinmesi" (B, E, D) | Ana çatı 3 | Decay + itiraz notu; "geçersiz" durumu; iptal durumu |
| R-09 | OTA/kanal fiyatının kazınması (scraping) (A, B, F) | Kullanım şartları/hukuk riski | Manuel + kanıt (K-14); lisanslı API (K-52) |
| R-10 | Rakip tedarikçi fiyatının pazarlıkta kullanılması; kanal fiyatı/avantaj %'nin müşteriye (açık kitapta bile) gösterilmesi (A, B) | Mevcut ürün kuralı; rekabet hukuku `[Doğrulanmalı]` | Otelin kendi kamuya açık fiyatı acenta kuralı, vars. kapalı (S-26) |
| R-11 | Herkese açık canlı sıralama tablosu (E, sahip) | Hedef 7 ve 2'ye zarar | Admin'e açılabilir anonim dağılım (S-10) |
| R-12 | Proje başı fiyat ölçütü (F/FİM) | Küçük işler sisteme girmez, hedef 7 delinir | Kullanıcı bandı + AI kredisi (S-21) |
| R-13 | Kendi kayıt platformu, QR kapı donanımı, canlı GPS, AI vardiya/atama planlama (D) | Efor/fayda düşük | Entegrasyon (K-47, K-52) |
| R-14 | RLS'i aşan "süper admin" destek hesabı (F) | Ana çatı 2 | Süreli destek erişimi (K-50) |
| R-15 | Sesle para/sözleşme onayı (F) | Ana çatı 5 | Sesli asistan yalnız okuma/taslak |
| R-16 | Belgelerde/müşteri sayfalarında platform logosu (F) | Acentanın markası | Tedarikçi sayfası "powered by" vars. kapalı (S-26) |

---

## ÜRÜN SAHİBİNE SORULAR

Önem sırasıyla; **[ACİL]** = v0.5 geliştirmesi başlamadan cevap gerekir (veri modeli, altyapı veya ilk sprint buna bağlı).
Mükerrer sorular birleştirildi; her sorunun altında kaynak komite soruları parantezde. Önceki kararlar (Q1–Q9) yeniden
sorulmadı; yalnız S-08 bir önceki kararın istisnasını soruyor.

### A. Dış iletişim ve ana çatı 6

**S-01 [ACİL] — Otomatik dış mesaj istisnası olacak mı?** (A-S1, F-S-4, B-S1, C-S5, D-Ç1)
Bağlam: "Talebiniz alındı", gece rötar bildirimi, kriz mesajı ve tahsilat hatırlatması için dört komite otomatik gönderim istedi.
Ana çatı 6 her dış mesajın insan onaylı ve insanın adresinden gitmesini şart koşuyor.
- (a) İstisna yok. Hızlı onay deseni (K-01): tek dokunuş, toplu kart, nöbetçi, eskalasyon; web formunda statik "alındı" ekranı. Bu mesaj türleri `NEVER_AUTO`.
- (b) Dar istisna: yalnız "alındı" türü; yönetici bir kez onaylar; değişken içermez (tarih/fiyat/taahhüt yok); kiracı kuralı, varsayılan kapalı. **ANA ÇATI ÇELİŞKİSİ**: `CLAUDE.md` ve `ai-authority.ts` güncellenir.
- (c) (b) + tedarikçiye yalnız saat/uçuş bilgisi taşıyan operasyon şablonları.

**Panel önerisi: (a)** (oy 21–4). Gerekçe: alıcının istediği şey otomasyon değil, 2 saatte teyit (Dr. Zeynep Karaca). Bunu K-01 + K-02 karşılıyor. İstisna bir kez açılırsa kapsamı büyür. Etkisi: (a) seçilirse kod değişikliği yalnız eklemeli olur; (b) seçilirse ana çatı metni, yetki listesi ve DB guard'ı değişir.

**S-02 [ACİL] — Acentanın kurumsal WhatsApp/SMS hattından giden mesaj "insanın adresinden" sayılır mı?** (D-S2, A-K3, E-K5)
Bağlam: 300 katılımcıya program değişikliğini kişinin kendi WhatsApp'ından göndermek pratik değil. Kurumsal hat paylaşılan bir kimlik.
- (a) Hayır; yalnız onaylayanın kendi kanalı (Gmail/M365, kişisel WhatsApp).
- (b) Evet, şu koşullarla: konuşma kişiye atanır, mesajda onaylayanın adı yer alır, onaylayan kimlik denetim izine yazılır, tek "yayın" onayında alıcı listesi görünür. Katılımcıya doğrudan iletişim proje ayarıyla açılır, varsayılan kapalı (müşteri açar).
- (c) Katılımcıya hiç mesaj gitmez; iletişim yalnız müşteri üzerinden yürür.

**Panel önerisi: (b).** Gerekçe: ana çatının amacı (hesap verebilir insan) korunuyor ve WhatsApp Business'ın gerçekliğine uyuyor. Etkisi: K-06, K-08 ve WhatsApp canlıya alma (K-31) bu yoruma göre tasarlanır. (b) bir ana çatı *yorumu* olduğu için `CLAUDE.md`'ye açıklama notu eklenir.

**S-09 — Kişisel hesaplar ve kişisel WhatsApp politikası** (E-S7, A-K3)
Bağlam: Kıdemli satışçılar müşteriyle kişisel WhatsApp'tan konuşuyor. Butik acenta kurucuları Gmail kullanıyor. Kişisel hesabı okumak hukuken riskli.
- (a) Kişisel hesaplar tamamen engelli.
- (b) Kurumsal hesap varsayılan; kişisel alan adları varsayılan engelli, admin istisna tanıyabilir (kayıt altında). Kişisel WhatsApp yalnız "projeye ilet" ile sisteme girer; sistem kişisel hesabı okumaz.
- (c) Serbest.

**Panel önerisi: (b).** Gerekçe: butik acentaların gerçeğiyle KVKK'daki ölçülülük ilkesi arasında denge kuruyor `[Doğrulanmalı]`. Etkisi: K-06; OAuth bağlama ekranına alan adı kuralı ve istisna kaydı gelir.

### B. Kapsam ve pazar (v0.5'in şekli)

**S-03 [ACİL] — Tedarik çekirdeği v0.5'te ne derinlikte olacak?** (B-S2, A-K9)
Bağlam: Kontrat fiyatı ve allotment bugün yok. Tek bir release hatası on binlerce EUR'ya mal olabiliyor. Tam modül L efor.
- (a) Çekirdek: kontrat fiyatı (statik + sezon), blok, release kademeleri, attrition saf fonksiyonu, opsiyon sırası ve uzatma, T-n kartları (K-11, K-12, K-13).
- (b) Tam modül: dinamik BAR−%x, hacim taahhüdü, şehir çapında blok, housing.
- (c) v0.6'ya ertelensin.

**Panel önerisi: (a).** Gerekçe: en büyük para kaybını M eforla kapatıyor ve hedef 8'in ölçütünü (kontrat çıpası) doğuruyor. Etkisi: v0.5'in en büyük iş paketi bu olur; domain'e attrition/release testleri eklenir.

**S-04 [ACİL] — İlk hedef segment ve kongre organizatörleri (PCO)** (F-S-2, D-S1, A-K19)
Bağlam: Butik acentalar çok sayıda ama düşük gelirli. DMC/PCO az sayıda, yüksek gelirli, satış süresi uzun. PCO'ya kayıt modülü olmadan satılmıyor.
- (a) Butik ve kurumsal acenta/DMC; PCO yok.
- (b) Karışık tasarım ortağı grubu (5–6 butik, 2–3 orta, 1–2 DMC/PCO). Ticari açılışta orta ölçek öncelikli. PCO için v0.5'te asgari katılımcı nesnesi (K-22), v0.6'da basit kayıt formu, yaka kartı dışa aktarımı ve kayıt platformu entegrasyonu (K-47).
- (c) PCO tam hedef: v0.5'te tam kayıt platformu (ödeme, oturum, QR).

**Panel önerisi: (b).** Gerekçe: birim ekonomisi orta ölçekte sağlam; PCO'ya kapı açılıyor ama 6 aylık platform işine girilmiyor. Etkisi: tasarım ortağı seçimi (K-37) ve katılımcı veri modeli bu cevaba göre şekillenir.

**S-05 [ACİL] — Barındırma yeri ve yurt dışı aktarım** (F-S-3)
Bağlam: Kamu ve bazı kurumsal müşteriler Türkiye'de barındırma isteyebilir. AI çağrıları her durumda yurt dışına gidiyor.
- (a) Türkiye'de.
- (b) AB bölgesinde.
- (c) Varsayılan AB; Kurumsal pakette Türkiye seçeneği.

**Panel önerisi: (c)**, avukat teyidiyle `[Doğrulanmalı]`. Gerekçe: maliyet ve olgunluk dengesi; yurt dışı aktarım mekanizması her senaryoda zaten gerekli. Etkisi: K-30 altyapı kurulumu, VİS ve alt işleyen listesi (K-36).

**S-16 — Uçak bileti v0.5 derinliği** (B-S6, F-S-9)
Bağlam: Bugün "bilet" yalnız genel bir hizmet kalemi. Time limit ve isim listesi hataları geri alınamıyor.
- (a) Takip katmanı: alanlar, time limit ve isim listesi kartları, ICAO isim eşleştirme (K-21); PNR metni ayıklama v0.6.
- (b) (a) + PNR metni ayıklama v0.5'te.
- (c) GDS/NDC ile bilet kesme.

**Panel önerisi: (a).** Gerekçe: riskin %80'i alanlar ve kartlarla kapanıyor; PNR metninde isim maskeleme önce çözülmeli. (c) için en az bir GDS ile ticari görüşme ve IATA yetkili acenta oranı ölçülmeli `[Doğrulanmalı]`. Etkisi: K-21 ile K-48 arasındaki iş bölümü.

### C. Para, fiyat ve kur

**S-06 [ACİL] — Finans kontrol kurallarının ortak varsayılanı ("kapora önce", ileride kredi limiti)** (C-S3, C-S6)
Bağlam: Sert bir blok otel opsiyonunu kaybettirebilir. Uyarı tek başına kalırsa kontrol kişiye bağlı kalır.
- (a) Yalnız bilgi.
- (b) Uyarı + gerekçe + Face ID ile istisna + haftalık istisna listesi; acenta "blok" seçebilir.
- (c) Blok.

**Panel önerisi: (b).** Gerekçe: satış esnekliği ile denetim izi aynı anda sağlanıyor; sektör farkı kuralla çözülüyor. Etkisi: K-16'nın kart davranışı; aynı kalıp v0.6'da kredi limitine (K-45) uygulanır.

**S-07 [ACİL] — Teklif kur politikası zorunlu mu ve kur riski payı müşteriye görünsün mü?** (B-S3, C-K8, A-K11)
Bağlam: TL maliyetli kalem, EUR teklif ve 120 gün geçerlilik. Kurumsal müşteri kur maddesi istiyor; tampon acentanın marjı.
- (a) Teklifte kur politikası alanı zorunlu (EUR / TL + ödeme günü kuru maddesi / TL sabit + tampon %). Tampon varsayılan olarak görünmez, acenta kuralıyla teklifte madde olarak gösterilir.
- (b) Tampon her zaman görünür.
- (c) Kur politikası isteğe bağlı.

**Panel önerisi: (a).** Gerekçe: "kur riskini teklifte yönetmeyen acenta kârını bankaya bağışlar" (Nermin Aksoy); şeffaflık müşteri tipine göre ayarlanıyor. Etkisi: K-15; teklif şablonuna kur maddesi değişkeni; madde metni hukukla `[Doğrulanmalı]`.

**S-08 — "Tedarikçiye müşteri adı gizli" kararına istisna** (A-S2)
Bağlam: Müşterinin zincir otellerle kendi kurumsal anlaşması olduğunda ad gizlenirse kurumsal fiyat kaybediliyor. Önceki kararınızı açan tek soru bu.
- (a) Kural mutlak kalır.
- (b) Müşteri bazında, yalnız müşterinin kurumsal anlaşma listesindeki tedarikçiler için açılır: bir kez yönetici kararı (karar kutusu), geri alınabilir, RFQ'da "müşteri adı açık" uyarısı, audit kaydı.
- (c) Her RFQ'da ayrı yönetici kararı.

**Panel önerisi: (b).** Gerekçe: kuralın amacı (tedarikçinin müşteriye doğrudan gitmesini önlemek) kurumsal anlaşmada zaten geçersiz; (c) gereksiz sürtünme yaratır. Etkisi: müşteri kartına "kurumsal anlaşmalı tedarikçiler" alanı, RFQ'da maskeleme kuralı.

**S-20 — Açık kitap (net + yönetim ücreti) fiyat modeli ne zaman?** (A-K6, A-S3)
Bağlam: Büyük kurumsal ve ilaç müşterileri çerçeve sözleşmede bunu şart koşuyor. Butik acentalar kullanmıyor.
- (a) v0.6'da müşteri bazında model; komisyon/override yalnız beyan alanı, iade müşteri sözleşmesine göre elle.
- (b) v0.5'te.
- (c) Hiç yapılmasın.

**Panel önerisi: (a).** Gerekçe: farklılaştırıcı ama para kaybı önlemiyor; v0.5 kapasitesi tedarik ve finans çekirdeğine ayrıldı. Etkisi: K-40; otomatik iade kalemi v0.7'de finans onayıyla.

**S-19 — TL (veya USD) ağırlıklı acentalar için raporlama** (C-S7, B-Ç5, F-S-6)
Bağlam: Yalnız yurtiçi çalışan bir acentaya "iç para biriminiz EUR" tuhaf geliyor. TL kâr Q5 gereği zaten var.
- (a) Yalnız EUR görünüm (+ mevcut TL kâr).
- (b) İç hesap EUR kalır; v0.6'da kiracı bazında görüntüleme/raporlama para birimi TL/USD seçilir, kaynak tutarlar çevrimsiz gösterilir.
- (c) Kiracıya iç para birimi seçtirilir. **ANA ÇATI ÇELİŞKİSİ (7)**.

**Panel önerisi: (b).** Gerekçe: satılabilirlik sağlanıyor, hesap tutarlılığı ve marj/markup kuralları bozulmuyor. (c) yalnız büyük bir müşteri şart koşarsa yeniden açılır. Etkisi: K-46'da gösterim katmanı.

### D. Finans süreçleri ve muhasebe

**S-17 — Sistem müşteri faturası kessin mi?** (C-S2)
Bağlam: Butik acenta tek tuşla fatura istiyor. Fatura kesmek vergi sorumluluğu, entegratör sözleşmesi ve mali mühür demek. PRD v0.4 kararı: sistem taslak üretir, muhasebe keser.
- (a) Hayır, her zaman taslak.
- (b) v0.7+'da opsiyonel, insan onaylı, entegratör/Paraşüt üzerinden.
- (c) v0.5'te kesim.

**Panel önerisi: (b).** Gerekçe: müşavir kanalı ürünün satış ortağı olur, rakibi değil; Komite C 7/10. Etkisi: v0.5–v0.6'da değişiklik yok; K-53.

**S-18 — Muhasebe aktarım sırası ve ikinci program** (C-S8, F-K-15)
Bağlam: Mikro Excel aktarımı var ama sütunları varsayım. Butik acentanın muhasebesi çoğu zaman müşavirin programında.
- (a) Mikro → Logo → Paraşüt → Netsis → Luca/Zirve sırasıyla.
- (b) v0.5'te Mikro doğrulaması ve cari eşleme (K-20); v0.6'da genel Excel/CSV + kanonik fiş, ikinci program anketle seçilir (K-44).
- (c) Önce Paraşüt API (küçük acentalar).

**Panel önerisi: (b).** Gerekçe: genel CSV her programa ve her müşavire kapı açıyor; ikinci programı tahmin değil veri seçmeli. Etkisi: anket K-37 kapsamında yapılır.

**S-23 — Dönem kilidi ve "düzeltme belgesi" (ana çatı 4'ün genişlemesi)** (C-S11)
Bağlam: Muhasebeye aktarılmış dönemde veri değişirse eski belge yine "eski" olur ve gönderilemez. Yol ise "yeniden üret" değil "düzeltme belgesi üret" olur. Bu ana çatıyı ihlal etmiyor, genişletiyor.
- (a) Onaylıyorum (v0.6).
- (b) Hayır, her zaman yeniden üretim.

**Panel önerisi: (a).** Gerekçe: aktarılmış muhasebe kaydının sessizce yeniden üretilmesi denetimde kabul görmez. Etkisi: K-43; ana çatı 4'e açıklama notu.

### E. İnsan, kontrol ve performans

**S-10 — Ekip performansında sıralama ve "kazanılan zaman"ın kişi bazında gösterilmesi** (A-S6, E-S1, E-S5)
Bağlam: Q7 raporu (admin herkesi görür) korunuyor. Açık olan nokta, akran sıralaması ve AI'nın kazandırdığı zamanın kişi bazında gösterilmesi.
- (a) Kişi kendini, admin herkesi görür; akran sıralaması yok; kazanılan zaman ekip bazında.
- (b) (a) + admin isterse ekip içi anonim dağılım ("ekip ortalaması ve senin yerin") ve kişi bazlı kazanılan zaman. İkincisinde rapora "kadro kararı dayanağı değildir" ibaresi eklenir.
- (c) Herkese açık sıralama tablosu.

**Panel önerisi: (a) varsayılan, acenta kuralıyla (b).** (c) reddedildi. Gerekçe: küçük ekipte sıralama bilgi paylaşımını durdurur (hedef 7). Büyük DMC'nin ihtiyacı kuralla karşılanıyor. Etkisi: K-27.

**S-11 — Satışçı primi sistemde hesaplansın mı?** (A-S4, E-S3)
Bağlam: Ticari komite primi benimsemenin anahtarı görüyor. İK ve avukat bordro/sözleşme riski görüyor `[Doğrulanmalı]`.
- (a) v0.5'te ilişki emeği (ciro, gerçekleşen kâr) satışçının panosunda; prim hesaplanmaz.
- (b) v0.6'da `rules` tabanlı **tahmini** prim satışçıya görünür; kesin prim finans onayıyla, tahsilat şartlı.
- (c) Prim hesaplaması ve onayı tamamen sistemde.

**Panel önerisi: v0.5'te (a), İK/hukuk görüşünden sonra v0.6'da (b).** Gerekçe: iki komitenin talebi aşamalandırılarak birleşti. Etkisi: K-04/K-27 ve v0.6'da prim kuralı.

**S-12 — "Tedarikçiye sözümüzü tutma" (karşılıklılık) göstergesi kime görünür?** (B-S9)
Bağlam: Tedarik komitesi göstergenin ekip performansına girmesini istiyor. İK, opsiyonun çoğu zaman müşteri veya yönetici gecikmesiyle kaçtığını hatırlatıyor.
- (a) Yalnız yönetici görür.
- (b) Yönetici ve ekip görür; acenta ve proje düzeyinde; kişi raporunda yalnız bağlamlı bilgi satırı, sıralamaya girmez.
- (c) Ekip performansında kişi bileşeni olur.

**Panel önerisi: (b).** Gerekçe: hedef 4 ölçülüyor ama kişiye haksız yazılmıyor. Etkisi: K-26, K-27.

**S-13 — Meşgul vekâleti (zaman aşımında vekile yönlendirme) varsayılanı** (E-S6)
Bağlam: Yönetici darboğaz. Zaman aşımında otomatik onay reddedildi (R-01).
- (a) Varsayılan kapalı, kural ile açılır.
- (b) Varsayılan açık, yalnız opsiyon/son tarih bağlantılı kartlarda: önce yöneticiye kritik bildirim, sonra vekil. Vekil para/sözleşme/teklifte Face ID kullanır. Akreditasyon ve kural değişikliği admin'de kalır.
- (c) Böyle bir mekanizma olmasın.

**Panel önerisi: (b).** Gerekçe: hedef 6'nın doğru okunuşu kontrolün yöneticiye de bağımlı kalmamasıdır. Etkisi: K-29; vekâlet kurallarına "bekleme süresi" eklenir.

**S-14 — Mesai dışı bildirim ve ilk yanıt SLA'sı** (E-S2, A-K10)
Bağlam: Alıcılar 2 saatte teyit bekliyor. 7/24 bildirim tükenmişlik ve fazla mesai delili riski doğuruyor `[Doğrulanmalı]`.
- (a) Sessiz saat varsayılan açık: kritikler geçer; nöbet ve etkinlik modu istisna; SLA iş saatinde ölçülür, müşteri bazında "acil" kuralı.
- (b) Kullanıcı seçer, varsayılan kapalı.
- (c) Kısıt yok.

**Panel önerisi: (a).** Gerekçe: hız ve insan sağlığı aynı anda korunuyor; işverenin hukuki konumu güçleniyor. Etkisi: K-02, K-29; nöbet çizelgesi kural tablosunda.

### F. Saha ve kişisel veri

**S-15 [ACİL] — Çevrimdışı pakette hangi kişisel veriler olacak?** (D-S3) `[Doğrulanmalı]`
Bağlam: Sahada internet kesiliyor; kriz yoklaması için bilgi gerekiyor. Kaybolan telefon KVKK riski.
- (a) Ad-soyad + oda no + transfer grubu (telefon yok).
- (b) (a) + telefon; rol bazlı (hostes yalnız kendi otobüsü), şifreli, uzaktan iptal, etkinlik bitince geçersiz.
- (c) Tam katılımcı kartı.

**Panel önerisi: (b).** (c) reddedildi. Gerekçe: kriz yoklaması telefon olmadan yapılamıyor; risk teknik tedbirlerle sınırlanıyor. Etkisi: K-24'ün veri seti ve aydınlatma metni (K-36).

### G. SaaS iş modeli ve platform

**S-21 — Fiyat ölçütü** (F-S-1)
Bağlam: Butik acentanın sezonda 15, kışın 2 projesi oluyor. Proje başı fiyat küçük işleri sistem dışına itiyor.
- (a) Kullanıcı bazlı (saha ücretsiz).
- (b) Proje bazlı.
- (c) Kullanıcı bandı + aylık AI kredisi; proje sayısı ölçüt değil. Sezon esnekliği yıllık ödemede indirimle verilir.
- (d) Kullanıcı bandı + aktif proje bandı + AI kredisi.

**Panel önerisi: (c).** Gerekçe: kurum hafızası (hedef 7) için her iş sisteme girmeli. AI maliyeti K-33 ile ölçülerek krediye bağlanıyor. Tutarlar `[Doğrulanmalı]`. Etkisi: K-35 entitlements yapısı; tasarım ortağı sözleşmeleri.

**S-22 — Acenta ayrılınca veya saklama süresi dolunca veri imhası (ana çatı 3)** (F-S-5, E-Ç5, D-Ç8)
Bağlam: DELETE yok kuralı ile KVKK imha yükümlülüğü ve "verimi silin" talebi çatışıyor.
- (a) Kripto-imha: kiracıya ya da kişiye özel anahtar imha edilir ve kayıt anonimleştirilir. Satırlar fiziksel olarak durur, audit'e "anahtar imhası" yazılır. Ayrılışta 90 gün salt okuma + dışa aktarım penceresi tanınır.
- (b) Yasal saklama sonrası fiziksel silme (ana çatı 3'e denetimli platform istisnası). **ANA ÇATI ÇELİŞKİSİ**.

**Panel önerisi: (a)**, avukat teyidiyle `[Doğrulanmalı]` (kripto-imha KVKK imhası sayılır mı; VUK saklama süreleri). Gerekçe: ana çatı korunuyor; mevcut şifreli PII mekanizması kullanılıyor. Etkisi: K-50 ve şifreleme anahtar yönetimi.

**S-24 — Kiracılar arası veri ürünleri: sektör benchmark'ı, fiyat endeksi, tedarikçi tek portalı (ana çatı 2)** (A-S7, F-S-7, F-S-8, B-Ç7)
Bağlam: Ağ etkisi güçlü. Ancak kiracı izolasyonu, gizli tedarikçi fiyatları ve rekabet hukuku (4054) riski var `[Doğrulanmalı]`.
- (a) Hiç yapılmasın.
- (b) v0.5'te yalnız hukuk görüşü alınsın. Uygulama gerekirse v0.7+'da ayrı hizmetle yapılır: opt-in, kiracı veritabanı dışında, k-anonim, bant bazlı, pazarlıkta kullanılmaz. Tedarikçi için kiracı verisi içermeyen kendi alanı açılır.
- (c) Kiracı verisi birleştirilerek şimdi yapılsın.

**Panel önerisi: (b).** (c) reddedildi. Gerekçe: güven ürünün temeli; tek bir sızıntı tüm sektör satışını bitirir. Etkisi: v0.5'te kod yok; K-54.

**S-25 — Sesli not varsayılanı** (F-K-9, D-D15)
Bağlam: Saha ekibi ve butik acenta sahibi sesli not kullanıyor. Tarayıcı ses tanıma sesi üçüncü taraf hizmete gönderebilir `[Doğrulanmalı]`.
- (a) Kiracı ayarı, varsayılan kapalı; yönetici kurulumda uyarıyı görerek açar; sunucu tarafı STT v0.6.
- (b) Varsayılan açık.
- (c) Sunucu STT gelene kadar kapalı.

**Panel önerisi: (a).** Gerekçe: bilinçli rıza ile pratik fayda dengeleniyor. Etkisi: K-32.

### H. Temkinli varsayılanlar paketi (toplu onay)

**S-26 — Panelin önerdiği küçük varsayılanlar paketi** (B-S4, B-S5, B-S8, A-S8, D-S4, D-S5, D-S6, D-S7, D-D20, E-S4, E-S8, C-S4, C-S9, C-S10, B-S7, F-S-10, F-K-12)
Bağlam: Aşağıdaki kararların her biri acenta kuralı (ayar) olarak uygulanacak. Panelin önerdiği temkinli varsayılanları tek tek sormak yerine topluca onayınıza sunuyoruz:

1. Otelin **kendi** kamuya açık fiyatı yazılı pazarlıkta kullanılabilir; acenta kuralı, varsayılan kapalı, rakamsız şablonla. Rakip fiyatı yasağı her durumda kalır.
2. RFQ'da bütçe alanı acenta kuralı, varsayılan kapalı.
3. Tedarikçi skoru tedarikçiyle paylaşılmaz. İstenirse puansız, nitel performans özeti taslağı hazırlanır (insan onaylı).
4. Tedarikçi sayfasında "powered by" imzası varsayılan kapalı; açan acentaya abonelik teşviki verilir. Belgelerde platform logosu hiç olmaz.
5. Kriz yetkisi için kriz vekili + kriz harcama tavanı (`rules`); vekil kendi Face ID'siyle onaylar.
6. Rooming farkı otele tedarikçi kartındaki ayarla gider; varsayılan "fark + güncel tam liste".
7. Etkinlik sonrası rapor süresi ayar olur, varsayılan 3 iş günü.
8. Katılımcıya doğrudan iletişim proje ayarı olur, varsayılan kapalı.
9. Katılımcı tercihleri projeler arasında yalnız açık rızayla saklanır `[Doğrulanmalı]`.
10. Ayrılan çalışanın kurumsal kutusu, yönetici onayıyla 90 gün devralanın projelerine bağlı kalır.
11. Ofis destek rolü v0.6'da asgari sürümle gelir.
12. Saha personeli v0.6'da yalnız kendi avans bakiyesini ve fişlerini görür; kârlılık ve alış fiyatı görmez ("saha finans göremez" kararı korunur).
13. Finansman maliyeti v0.6'da ayrı bir "nakit ağırlıklı kâr" göstergesi olur; muhasebe kârına karışmaz.
14. Faturalama modelini sistem önerir, finans/yönetici onaylar.
15. Vize/sigorta poliçe takibi v0.6'da gelir; poliçe satışı yapılmaz.
16. "Kaçak taraması — bulamazsak ilk ay ücretsiz" garantisi yalnız tasarım ortaklarıyla denenir.
17. Ayrılan acentaya 90 gün salt okuma + dışa aktarım penceresi tanınır.

Seçenekler: (a) paketi olduğu gibi onayla · (b) belirtilen maddeleri değiştir.
**Panel önerisi: (a).** Gerekçe: hepsi temkinli, geri alınabilir ve ana çatıyla uyumlu. Etkisi: `DEFAULT_RULES` ve ilgili ayar ekranları.

### Acil sorular özeti

v0.5 başlamadan cevap gereken sorular: **S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-15**. Diğerleri ilgili maddeye gelinene
kadar panelin önerisiyle (temkinli varsayılan) ilerlenebilir; cevap gelince kural değeri değiştirilir.

---

## v0.5 kapsam önerisi

### v0.5 — iş paketleri

| Paket | Kararlar | Efor | Bağımlılık / sıra | Hedefler |
|---|---|---|---|---|
| **P0 — SaaS zemini** (ilk sprintten itibaren, paralel) | K-30 güvenlik, K-31 canlı doğrulama + başvurular, K-32 PII maskeleme, K-33 AI'sız mod + ölçüm, K-34 doğruluk seti (B), K-35 paketleme + gölge mod (B), K-36 KVKK paketi, K-37 tasarım ortakları | L + 3M + 2 S–M + kod dışı | S-05 (barındırma) → K-30; başvurular 1. hafta | 6, 7, 9, 10 |
| **P1 — Tedarik çekirdeği** | K-11 kontrat fiyatı, K-12 allotment + attrition, K-13 opsiyon, K-14 fiyat kıyası + kanıt, K-26 karşılıklılık (B) | 3M + S–M + S | S-03; K-12 → K-10'un attrition kartı; K-14 kontrat çıpası için K-11 | 8, 10, 4, 2 |
| **P2 — Para ve kontrol** | K-15 kur politikası, K-16 ödeme planı + kapora önce, K-17 nakit akış (B), K-18 ödeme güvenliği, K-19 üç kolon kârlılık, K-20 Mikro doğrulama | 3M + 3S | S-06, S-07; K-16 → K-17; Mikro doğrulaması için pilot acentanın muhasebecisi | 10, 6, 2 |
| **P3 — Operasyon temeli** | K-09 program, K-10 rooming revizyon, K-08 değişiklik/taahhüt + yayın, K-22 katılımcı, K-21 uçuş takip (B), K-23 kriz paketi, K-24 çevrimdışı paket, K-25 saha kriterleri | 5M + 2 S–M + S | K-09 → K-08, K-24; K-22 → K-10; S-02 → yayın kanalı; S-15 → K-24 | 1, 2, 5 |
| **P4 — Müşteri, hafıza, insan** | K-01 hızlı onay, K-02 SLA, K-03 portal, K-04 ilişki sahibi, K-05 devir, K-06 kanal, K-07 yazışma analizi, K-27 adil metrik, K-28 gözetim sınırı, K-29 bildirim + meşgul vekâleti (B) | 3M + 3 S–M + 4S | S-01 → K-01; S-09 → K-06; K-04 → K-03, K-05; K-31 → K-06 | 3, 5, 6, 7, 9 |

Önerilen sıra: **1. ay** P0 başvuruları + K-30 başlangıcı, K-09 program, K-11 kontrat, K-16 ödeme planı (diğer işlerin veri
temeli); **2.–3. ay** K-12/K-13, K-10, K-15, K-18, K-01/K-02, K-04/K-03; **4.–5. ay** K-08, K-22, K-24, K-05, K-07, K-27/K-28;
**6. ay** v0.5-B maddeleri, sızma testi, tasarım ortaklarıyla canlı kabul. Her adımda `CLAUDE.md` çalışma düzeni (typecheck, vitest,
build, e2e) yeşil kalır; her yeni akışa `e2e/scenarios/` altında bir tarayıcı senaryosu eklenir.

**Kesim gerekçesi:** komitelerin P1 listesi ≈ 140 geliştirici-haftasıydı. Dört ölçüt uygulandı: para kaybı veya geri alınamaz
hata, tasarım ortaklarına açılmanın ön koşulu, başka bir v0.5 maddesinin bağımlılığı, `[Doğrulanmalı]` teyidinin tamamlanmış
olması. Ölçütü geçmeyen değerli işler v0.6'ya alındı; hiçbiri reddedilmedi.

### v0.6+ yol haritası

| Sürüm | İçerik | Ön koşul |
|---|---|---|
| **v0.6** (v0.5 + ~4–5 ay) | K-38 transfer (ilk iş), K-43 vergi doğruluğu dalgası, K-44 muhasebe çerçevesi + ikinci program, K-50 SaaS ikinci dalga (dışa aktarım, destek erişimi, sihirbaz, SSO, abonelik), K-46 EN belgeler + TL/USD görünüm, K-39 CRM-lite, K-40 açık kitap, K-41 markup boyutları + pax bandı, K-42 tedarikçi skoru, K-45 finans üçüncü halka, K-47 PCO kapısı, K-48 PNR/vize/rider, K-49 operasyon/insan ek paketi | v0.5'te program, uçuş, katılımcı ve ödeme planı verisi; SMMM teyitleri; muhasebe anketi; K-50 **ticari açılıştan (Aşama B) önce** zorunlu |
| **v0.7** | K-51 uyum kuralları + maliyet merkezi, K-52 uçuş API / GDS / bedbank / tam allotment, kampanya + İYS, DE/RU | Lisanslı API sözleşmeleri, hukuk görüşleri |
| **v0.8+** | K-53 fatura kesimi (entegratör), sanal POS, yazma API'si + pazaryeri, native iOS, özel alan adı; K-54 (yalnız S-24 kararı ve hukuk görüşüyle) | Ürün–pazar uyumu, Aşama C (bölgesel DMC'ler) |

### Reddedilenler (özet)

Ayrıntı ve gerekçe [Reddedilenler](#reddedilenler) tablosundadır (R-01…R-16). Hepsinin uyumlu bir alternatifi vardır. Kısaca:
otomatik onay, Face ID atlama, çevrimdışı onay, AI'nın para/konfirmasyon/dış mesaj işlemleri, çalışan gözetimi ve profilleme,
misafir verisinin modele gitmesi, kayıt silme, scraping, rakip fiyatı, açık sıralama tablosu, proje başı fiyat, kendi kayıt
platformu/donanım, RLS'i aşan destek hesabı, sesle onay, belgelerde platform logosu.

---

## Ana çatı çelişkileri ve uyumlu alternatifler

| # | Öneri (komite) | Çelişen madde | Durum | Uyumlu alternatif |
|---|---|---|---|---|
| Ç-01 | Otomatik "alındı" mesajı (A, F); gece rötar bildirimi (B); kriz şablonu otomatik (D); onaysız tahsilat hatırlatması (C) | 6 | **Ürün sahibine (S-01)**, panel: istisna yok | K-01 hızlı onay deseni + web formu statik ekranı; `NEVER_AUTO` |
| Ç-02 | Kurumsal WhatsApp/SMS hattından gönderim | 6 ("insanın adresi") — yorum | **Ürün sahibine (S-02)** | Kişiye atama + onaylayanın adı mesajda + audit; katılımcıya vars. kapalı |
| Ç-03 | Kiracı bazlı iç para birimi (TL/USD) (B, C, F) | 7 | **Ürün sahibine (S-19)**, panel: değişmesin | Görüntüleme/raporlama para birimi (K-46), kaynak tutar saklama, TL kâr Q5 |
| Ç-04 | Kiracılar arası benchmark, fiyat endeksi, ortak tedarikçi profili/portalı (A, B, F) | 2 (+ rakip fiyatı kuralı) | **Ürün sahibine (S-24)**, panel: v0.5'te yalnız hukuk görüşü | Opt-in, kiracı DB dışı, k-anonim, bant bazlı ayrı hizmet; tedarikçinin kiracı verisi içermeyen kendi alanı |
| Ç-05 | Fiziksel silme: acenta çıkışı, KVKK imhası (F, E, D) | 3 | **Ürün sahibine (S-22)**, panel: kripto-imha | Anahtar imhası + anonimleştirme, `offboarded`, audit kaydı |
| Ç-06 | Tedarikçi skorunun, kişisel notun, misafirin silinmesi; hatalı faturanın silinip yeniden girilmesi (B, E, D, C) | 3 | Reddedildi | Zaman ağırlıklı skor + itiraz notu; "geçersiz"/iptal durumu; ters belge (K-43) |
| Ç-07 | Zaman aşımında otomatik onay (E); kriz anında Face ID atlama (D); çevrimdışı onay (D) | 5 | Reddedildi | Meşgul vekâleti (K-29); kriz vekili + tavan (K-23); sözlü onay teyit kartı (K-08) |
| Ç-08 | AI bilet kesme (B), otomatik forward (C), banka API'siyle ödeme (C), AI'nın POS linki göndermesi (C), release'in otele otomatik iletimi (B) | 6 (ve 5) | Reddedildi | Kart + insan; yalnız Face ID onaylı ödemelerden dosya (K-18); release taslağı (K-12) |
| Ç-09 | Pasaport OCR'ı modele (B); alerji/diyet AI (D); yazışmada katılımcı adları (D); e-Arşivde misafir TCKN'si (C) | 9 | Reddedildi | Model dışı MRZ, deterministik sayım (K-22), "Katılımcı#17" maskeleme, PII yalnız şifreli depoda |
| Ç-10 | Çevrimdışı cihazda misafir PII (D) | 9 | Koşullu uyumlu (S-15) | Asgari alan, şifreli, rol bazlı, uzaktan iptal, süre sonu geçersiz (K-24) |
| Ç-11 | Çevrimdışı kayıtların sonradan senkronu (D) | 3 | Uyumlu, dikkat | Sunucuya ulaşınca yazılır; cihaz + sunucu zamanı; çakışmada üzerine yazma yok |
| Ç-12 | Çalışan profilleme / ayrılma riski skoru (E) | 6 ruhu, 9 | Reddedildi | AI yasak listesine **eklemeli** madde (K-28) + olay bazlı anomali |
| Ç-13 | Kişisel Gmail/WhatsApp'ın okunması (E) | 9, 6 | Reddedildi | Kurumsal hesap + "projeye ilet" (K-06, S-09) |
| Ç-14 | Islak imza fotoğrafıyla otomatik "imzalı" (E); devralanın ayrılanın adresinden göndermesi (E) | 5, 6 | Reddedildi | "Kilitle" kartı; her mesaj devralanın adresinden (K-05) |
| Ç-15 | Eşiklerin (bekleme dakikası, attrition toleransı, hatırlatma, sessiz saat, anomali, vergi oranı, tampon) koda yazılması (tüm komiteler) | 8 | Önlendi | Hepsi `rules`; vergi parametreleri yürürlük tarihli; abonelik hakkı ayrı `tenant_entitlements` (K-35) |
| Ç-16 | Program/manifest/föyün ayrı elle düzenlenen belgeler olması (D) | 4 | Önlendi | Tek program verisinden üretim (K-09) |
| Ç-17 | Dönem kilidinde "düzeltme belgesi" (C) | 4'ün **genişlemesi** (ihlal değil) | Ürün sahibine bilgi (S-23) | Eski belge yine "eski", gönderilemez; yalnız iyileştirme yolu farklı |
| Ç-18 | RLS'i aşan destek "süper admin"i (F) | 2 | Reddedildi | Süreli, onaylı, `withTenant` içinde destek erişimi (K-50) |
| Ç-19 | Yeni tablolar (kontrat, blok, ödeme planı, katılımcı, olay, program, devir…) | 2 | Uyumlu, uygulama notu | Her yeni tablo `tenant_id` + `apply_standard_policies` + `apply_tenant_foreign_keys`; migration numarası çakışmaz; `api.ts` eklemeli |

**Kalan ANA ÇATI ÇELİŞKİSİ (ürün sahibi kararı bekleyen):** Ç-01 (S-01 b/c), Ç-02 (S-02 — yorum), Ç-03 (S-19 c), Ç-04 (S-24 c),
Ç-05 (S-22 b). Panel beşinde de ana çatıyı değiştirmeyen seçeneği önermektedir; ürün sahibi aksini seçerse `CLAUDE.md`
"Ana çatı" metni ve ilgili guard'lar aynı değişiklikte güncellenmelidir.

---

## [Doğrulanmalı] listesi

| # | Konu | Kim doğrulamalı | Bağlı karar / soru | Zamanlama |
|---|---|---|---|---|
| D-01 | KDV ve konaklama vergisi oranları; kalem faturalama modelleri (kendi nam ve hesabına / aracılık / masraf yansıtma) ve matrah; iptal bedelinin KDV durumu; kur farkı faturasında KDV hesap yöntemi; kamu müşterilerinde tevkifat; fişsiz harcama (KKEG); hizmetten sonra fatura süresi; e-Fatura ticari senaryo itiraz süresi | SMMM/YMM (gerekirse özelge) | K-43, K-45, S-26/14 | v0.5 içinde (v0.6 ön koşulu) |
| D-02 | TCMB kur türü: döviz alış mı, efektif mi, aynı gün mü önceki gün bülteni mi (Q5'ten açık) | Mali müşavir | K-19 | v0.5 |
| D-03 | VUK/TTK belge saklama süreleri ile KVKK imha yükümlülüğünün dengesi; kripto-imhanın KVKK anlamında imha sayılıp sayılmadığı | KVKK avukatı + mali müşavir | S-22, K-50 | v0.5 |
| D-04 | Yurt dışı aktarım mekanizması (AI sağlayıcı, e-posta, WhatsApp, barındırma); barındırma yeri şartları (kamu, kurumsal); VİS ve alt işleyen listesi | KVKK avukatı | S-05, K-36 | **Acil** |
| D-05 | Ticari muhatap (müşteri irtibat kişisi) verisinin işleme dayanağı; "kurumsal tercih" ↔ "kişiye ait hassas not" ayrımı | KVKK avukatı | K-39 | v0.6 öncesi |
| D-06 | Çevrimdışı pakette telefon numarası; katılımcı verisinde veri sorumlusu (müşteri) ↔ veri işleyen (acenta) rolleri; sağlık/alerji için açık rıza metni; katılımcı tercihlerinin projeler arası saklanması; matbaa/yaka kartı aktarımı | KVKK avukatı | S-15, K-22, K-24, S-26/9 | **Acil** (S-15) |
| D-07 | Çalışan izleme sınırı ve aydınlatma metni; kişisel alan adlı hesapların bağlanması; ayrılış sonrası kutu yönlendirme süresi; KVKK m.11 (otomatik karar itirazı); ayrılış modu kısıtları | KVKK/iş hukuku avukatı | K-05, K-06, K-27, K-28, S-09 | v0.5 |
| D-08 | Sessiz saat ve fazla mesai delili; prim hesabının bordro/iş sözleşmesi niteliği; TBK m.444–447 rekabet yasağı, ticari sır; eşit davranma (İş K. m.5) ve yetki değerlendirme gerekçesi | İş hukuku avukatı | S-11, S-14, K-49 | v0.5 (S-14), v0.6 (S-11) |
| D-09 | Rakip fiyatı ve tedarikçiler arası fiyat bilgisi taşınması; sektör fiyat endeksi ve benchmark (4054 sayılı Kanun) | Rekabet hukukçusu | R-10, S-24, S-26/1 | v0.5 (görüş) |
| D-10 | Seyahat sigortası "satış" ↔ "takip" ayrımı (sigorta aracılığı mevzuatı) | Sigorta hukukçusu | K-48, S-26/15 | v0.6 öncesi |
| D-11 | İlaç sektörü tanıtım kuralları (TİTCK yönetmeliği, sektör etik kuralları): HCP harcama sınırları, refakatçi, mekân | İlaç uyum uzmanı / müşteri uyum birimi | K-51 | v0.7 öncesi |
| D-12 | Ticari elektronik ileti ve İYS kaydı (kampanya, vaka çalışması, katılımcı mesajları) | Hukuk | K-53, S-02 | v0.6 |
| D-13 | OTA kullanım şartları, ekran görüntüsü kanıtının saklanması; lisanslı rate-shopping ve bedbank API koşulları ("acentanın kendi hesabı") | Hukuk + sağlayıcılar | K-14, K-52 | v0.5 (kanıt), v0.7 (API) |
| D-14 | Havayolu grup kuralları: isim listesi son tarihi, depozito, isim değişikliği ücretleri, ADM riskleri; IATA yetkili acenta oranı; bilet bedelinin aracılık mı kendi satış mı olduğu | Bilet uzmanı + havayolu grup masaları + SMMM | K-21, S-16 | v0.5 |
| D-15 | Transfer sözleşmelerinde ücretsiz bekleme süreleri, gece tarifesi, akaryakıt endeksi | Satın alma (tedarikçi sözleşmeleri) | K-38 | v0.6 öncesi |
| D-16 | Rehber kokartı / TUREB yükümlülükleri, belge geçerlilik kuralları | TUREB / hukuk | K-25 | v0.5 |
| D-17 | Mikro aktarım sütunlarının gerçek kurulumda doğrulanması; Logo/Paraşüt/Luca şablonları; muhasebe programı dağılımı | Mikro bayi + muhasebe program uzmanları + acenta anketi | K-20, K-44, S-18 | v0.5 |
| D-18 | Banka ekstre formatları (MT940, CAMT.053, banka bazlı Excel); BSMV/SWIFT masraf sınıflandırma eşikleri | Bankalar + mali müşavir | K-44 | v0.6 |
| D-19 | WhatsApp Business: Embedded Signup / teknoloji sağlayıcı başvurusu, şablon onayı, konuşma bazlı ücretler ve kiracıya yansıtma | Meta / BSP | K-31, S-02 | **Acil** (başvuru 1. hafta) |
| D-20 | Google OAuth uygulama doğrulaması / güvenlik değerlendirmesi; Microsoft Graph izinleri | Google / Microsoft | K-31 | **Acil** |
| D-21 | iOS PWA web push şartları (ana ekrana ekleme, sürüm) | Mühendislik | K-35, onboarding | v0.5 |
| D-22 | Toplu Face ID onayın mevcut karar kutusunda olup olmadığı | Mühendislik (kod kontrolü) | K-18 | v0.5 başı |
| D-23 | AI sağlayıcının veri saklama/eğitim koşulları; proje başı gerçek AI maliyeti | Sözleşme (hukuk) + pilot ölçümü | K-32, K-33, S-21 | v0.5 |
| D-24 | Tarayıcı Web Speech API'sinin sesi nereye gönderdiği; sunucu tarafı STT sağlayıcısının veri yerleşimi | Mühendislik + KVKK avukatı | S-25, K-32 | v0.5 |
| D-25 | Pazar: MICE yapan acenta sayısı, rakipler, fiyat aralıkları, CAC/LTV, terk oranı; uçuş durumu API'si ve SMS sağlayıcısı seçimi | İş geliştirme (10–15 acenta görüşmesi) + mühendislik | K-37, S-21, K-52 | v0.5 (paralel) |
| D-26 | Müşteri sözleşmesinde kur maddesi, ödeme planı ve iptal/no-show maddelerinin metni; açık kitap modelinde "faturanın müşteriye ibrazı" maddesi | Sözleşme avukatı + finans | K-15, K-16, K-40 | v0.5 (kur, ödeme), v0.6 (açık kitap) |

---

## Ek: komite raporları

Altı komite raporu ve ortak brifing, sürümlü kalmaları için `docs/panel/` altına kopyalandı (içerik değiştirilmedi):

| Dosya | Komite | Kapsam |
|---|---|---|
| [panel/BRIEF.md](panel/BRIEF.md) | Ortak brifing | Ürün, 10 hedef, bugün olanlar/olmayanlar, ana çatı, önceki kararlar |
| [panel/A-ticari.md](panel/A-ticari.md) | A — Ticari | Satış, pazarlama, müşteri, gelir; K1–K19, S1–S8 |
| [panel/B-tedarik.md](panel/B-tedarik.md) | B — Tedarik | Satın alma, otel, bilet, transfer, AV, vize; K1–K20, S1–S9 |
| [panel/C-finans.md](panel/C-finans.md) | C — Finans | Kur, kapora, vergi, muhasebe, banka, iç kontrol; K1–K26, S1–S11 |
| [panel/D-operasyon.md](panel/D-operasyon.md) | D — Operasyon | Program, rooming, saha, çevrimdışı, kriz, PCO; D1–D23, Soru 1–7 |
| [panel/E-yonetim-insan.md](panel/E-yonetim-insan.md) | E — Yönetim–İnsan | Kontrol, adalet, devir, gözetim sınırı, bildirim; K1–K20, Soru 1–8 |
| [panel/F-urun-saas.md](panel/F-urun-saas.md) | F — Ürün–SaaS | Paketleme, AI sınırları ve maliyeti, güvenlik, entegrasyon, GTM; K-1–K-27, S-1–S-10 |

Komite raporlarındaki karar numaraları (ör. "B-K2") bu dokümandaki birleştirilmiş kararlara (K-xx) şu ilkeyle bağlandı: her
komite kararı ya bir K-xx'in içinde, ya v0.6+/red tablolarında, ya da bir S-xx sorusunda yer alır. Hiçbir komite kararı
düşürülmedi.
