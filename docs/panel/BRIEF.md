# Uzman paneli — ortak brifing (MICE AI Operations OS)

## Ürün
Kurumsal toplantı, kongre, teşvik gezisi ve etkinlik (MICE) organize eden acentalar için yapay zekâ destekli operasyon sistemi.
Önce tek acentada kanıtlanacak, sonra teknolojiye/yapay zekâya açık TÜM acentalara SaaS olarak satılacak. Panelin
kararları tüm sektöre hitap etmelidir (butik acentadan büyük DMC'ye, kongre organizatörüne).

## Ürün sahibinin 10 hedefi
1. Takibi kolaylaştırmak
2. Hataları minimuma indirmek
3. Müşteriye maksimum hızda geri dönüş
4. Tedarikçilerle iyi ilişki, güçlü bağ
5. Müşteriye güvenilir bir irtibat bırakmak
6. Acenta sahibinin kontrolünü kişilere değil sisteme bağlamak
7. Çalışan ayrılsa bile kurum hafızasının kalıcı olarak şirkette kalması
8. Acenta–tedarikçi ilişkisinde fiyat değişkenliğini minimuma indirmek
9. Sözleşme, program gibi konularda acenta–müşteri yazışmalarını analiz edip tüm soruların doğru, tutarlı, eksiksiz cevaplanması
10. Hesap hatalarını önlemek, kârlılığı maksimize etmek, gelir-gideri kontrol altına almak

## Bugün sistemde olanlar (PRD v0.4'e göre uygulandı, testli)
- İş akışı 0–8: talep analizi (e-posta/WhatsApp/telefon notu/ses → AI ayıklama + güven puanı, mükerrer kontrolü, eksik bilgi sorusu,
  proje kodu PRJ-####) → tedarikçi kısa listesi + RFQ (3–5 tedarikçi, giriş gerektirmeyen tedarikçi linki, 24s hatırlatma/48s telefon görevi)
  → teklif okuma + normalizasyon (kişi/gün, KDV hariç, konaklama vergisi ayrı, EUR) + kanal (OTA) fiyatıyla avantaj % + "iyi/normal/bilmiyorum"
  + pazarlık taslağı (yalnız hacim/ilişki/esnek tarih/ödeme kolaylığı; rakip fiyatı yasak; en fazla 3 tur) → müşteri teklifi (2–3 seçenek,
  PDF + online onay linki, opsiyon tedarikçiden uzun olamaz, hedef marj altı bloklanır) → müşteri onayı (online / PO / imzalı form,
  revizyon, kayıp nedeni zorunlu) → sözleşme (alan alan sözleşme–teklif farkı, koşul riski, imza kilidi, ek protokol) → operasyon takvimi,
  rooming list (KVKK rızası), saha ekstraları (5.000/15.000 TL limit, müşteri link onayı), günlük özet → fatura okuma, ödeme talebi→yönetici
  Face ID onayı, banka ekstresi eşleştirme, Mikro Excel aktarımı, e-Fatura UBL okuma → kapanış kontrolü, gerçekleşen fiyat, tedarikçi skoru,
  kontrol listesi önerisi, müşteri anketi.
- Markup kademeleri (maliyet üzerine): kanal avantajı <%5→%5, 5–10→10, 10–15→15, 15–20→20, ≥20→25. Marj ve markup her yerde ayrı.
- Karar kutusu (yönetici telefonda yalnız kendisinden karar bekleyen kartları görür), kişi bazlı yetki seviyesi, vekâlet,
  otomasyon terfisi (20 düzeltmesiz onay → "otomatik yapayım mı?", 1/20 örneklem, hata → geri dönüş), kural önerisi üreticisi,
  haftalık gelişim raporu, ekip performans raporu (yapılıyor), ilk veri yükü (son 18 ay, elle doğrulama).
- Gerçekleşen kâr: tahsilat/ödeme günü kuru (TCMB) ile EUR + TL, kanıt tablosu (yapılıyor).
- Gelen e-posta/WhatsApp otomatik projeye bağlanır; kişinin kendi Gmail/M365 adresinden gönderim; WhatsApp/SMS; web push.
- Çok kiracılı (her acenta ayrı, veritabanı düzeyinde izolasyon), silinmez kayıt + denetim izi, KVKK (misafir verisi şifreli, rıza),
  AI kapalı yetki listesi (para hareketi, konfirmasyon, imza, akreditasyon, kural değişikliği, onaysız dış mesaj YASAK).
- Web tabanlı PWA: yönetici telefon, ekip masaüstü, saha telefon; müşteri/tedarikçi giriş gerektirmeyen link sayfaları.

## Henüz OLMAYANLAR (bilinen boşluklar)
- Uçak bileti modülü (GDS/NDC, PNR, bilet kesme, ücret kuralları, TKT time limit) — yok; "bilet" sadece genel bir hizmet kalemi türü.
- Transfer modülü detayı (araç planlama, uçuş takibi, karşılama listesi, şoför/araç ataması) — yok; transfer genel kalem.
- Vize, seyahat sigortası, rehber/hostes, katılımcı kayıt (kongre registration), yaka kartı, abstract yönetimi — yok.
- Satış/CRM/pipeline modülü, pazarlama (kampanya, müşteri segmentasyonu, NPS) — yok (Faz 3).
- OTA/kanal fiyatına otomatik erişim yok (manuel giriş); Mikro dışında muhasebe programı (Logo, Netsis, Luca, Paraşüt) aktarımı yok.
- Allotment / kontenjan / grup blokesi yönetimi, tedarikçi ile yıllık anlaşmalı fiyat (kontrat fiyatı) yönetimi — yok.
- Yazışma analizi (sözleşme/program soruları için müşteri yazışmalarının tamamını tarayıp tutarlı cevap) — kısmen ("Bu projeye sor").
- SaaS açılışı (acenta kaydı, abonelik, faturalama, onboarding) — yok.

## Değişmez mimari (CLAUDE.md) — panel bunlara AYKIRI öneri yaparsa "ANA ÇATI ÇELİŞKİSİ" diye işaretlemeli
1 monorepo/sözleşme · 2 PostgreSQL + çok kiracılı izolasyon · 3 silinmez kayıt + denetim izi · 4 belgeler veriden, değişince "eski" ·
5 onay kapıları karar kutusunda, para/sözleşme/teklif onayında Face ID · 6 AI kapalı yetki listesi, dış mesaj insan onaylı ve insanın adresinden ·
7 iç para birimi EUR, marj/markup ayrı · 8 kurallar tabloda, yönetici değiştirir · 9 KVKK.

## Daha önce ürün sahibinin verdiği kararlar
Vekil marj altı teklifi açabilir ama karar yöneticide; kaybedilen proje "lost"+neden, müşteri linki kapanır, açık kartlar kayıt altında kapanır;
ekip performansı (12 ay, kazanma %, kârlılık %); PO numarası müşterinin numarası, proje kodumuzdan ayrı; hızlı revizyon aynı dosyada Rev.2;
TL kârlılık ödeme/tahsilat günü kuruyla; tüm kullanıcılar müşteri talebi girebilir; tedarikçiye müşteri adı gizli; saha finans göremez;
müşteri teklifi otomasyona terfi etmez.
