# 05 — Faz 1 Teknik Planı, Takvim ve Maliyet (§19.4, §18.17)

> PRD karşılığı: §12 Faz 1 kapsamı (veri merkezi, Adım 0–5, onay kapıları, belge üretimi, sözleşme–teklif fark kontrolü), §18.17.
> Mimari: [01-mimari.md](01-mimari.md). Veri modeli: [02-veri-modeli.md](02-veri-modeli.md).

## 1. Faz 1 kapsamı (teknik)

| Dahil | Faz 1'de basit tutulan | Faz 2+ |
|---|---|---|
| Veri merkezi: tedarikçi, fiyat geçmişi, müşteri/proje, kurallar, kontrol listesi | Kanal fiyatı yalnızca **manuel giriş yardımı** ile | OTA/toptancı iş ortaklığı API'si |
| Adım 0–5: intake, RFQ + tedarikçi linki, okuma, karşılaştırma, pazarlık taslağı, teklif + PDF + online onay, sözleşme okuma + fark + imza kilidi | Takip işçisi: RFQ 24/48 saat, teklif takibi, opsiyon alarmı | Adım 6–8'in tamamı (operasyon, finans eşleştirme, kapanış) |
| Karar kutusu (mobil PWA), Face ID step-up, Web Push | WhatsApp: talep alma ve onaylı taslak gönderme | Saha paneli çevrimdışı modu (Faz 2 başı) |
| Audit, RLS, silinmezlik, belge eskime yayılımı | Taahhüt kaydı (borç/alacak) imza anında oluşur | Banka entegrasyonu (Faz 3) |
| Gmail veya Microsoft 365 entegrasyonu (acentanın kullandığı sağlayıcı) | Mikro için Excel dışa aktarımı (basit şablon) | e-Fatura XML okuma (Faz 2) |
| Başlangıç ölçümü: talep → teklif süresi | Sesli komut: tarayıcıda kayıt + bulut STT (Faz 1 sonu, opsiyonel) | Haftalık gelişim raporu, tam versiyon |

## 2. Entegrasyon sırası ve gerekçesi

| Sıra | Entegrasyon | Neden bu sırada | Ön koşul / uzun teslim süreli iş |
|---|---|---|---|
| 1 | **Claude API** (`@anthropic-ai/sdk`) + mock | Tüm ayıklama ve okuma buna dayanır. Mock sayesinde geliştirme anahtarsız sürer | API hesabı; veri işleme koşulları ve KVKK değerlendirmesi (07 §2) |
| 2 | **E-posta** (Gmail API veya MS Graph) | Talebin ve RFQ yanıtlarının ana kanalı. "Kendi adresinden gönderim" ilkesinin temeli | Workspace/M365 yöneticisinin uygulama onayı (dahili uygulama); 1. haftada başlatılmalı |
| 3 | **PDF üretimi** (pdfkit) + nesne deposu | Teklif belgesi Adım 3'ün çıktısı | Acenta şablonunun (logo, metinler) teslimi |
| 4 | **Web Push + WebAuthn** | Karar kutusunun mobil kullanımı | iOS 16.4+ cihazda ana ekrana ekleme testi (08) |
| 5 | **WhatsApp Business API** | Talep kanalı. Saha iletişimi Faz 2'de | Meta Business doğrulaması, numara taşıma kararı, şablon onayı. **2–6 hafta sürebilir**, bu yüzden 1. haftada başvurulmalı |
| 6 | **Mikro Excel dışa aktarımı** | Faz 1 sonunda müşteri faturası taslağını muhasebeye aktarmak için | Mikro'nun içe aktarım şablonunun acentadan örnek dosyayla alınması (07 §4) |
| 7 | Konuşma tanıma (STT) | Değerli ama kritik yolda değil | Servis seçimi ve KVKK |

## 3. Ekip

| Rol | Yük | Sorumluluk |
|---|---|---|
| Teknik lider / full-stack | 1,0 TZE (tam zaman eşdeğeri) | Mimari, veritabanı (RLS, tetikleyiciler), AI katmanı, kod incelemesi |
| Backend geliştirici | 1,0 TZE | API, entegrasyonlar (mail, WhatsApp), worker, belge üretimi |
| Frontend / PWA geliştirici | 1,0 TZE | Karar kutusu, proje ekranı, public sayfalar, WebAuthn, push |
| Ürün tasarımcısı | 0,5 TZE (ilk 8 hafta) → 0,2 | Mobil karar kutusu ve masaüstü ekran akışları (prototip mevcut) |
| QA / test | 0,5 TZE | E2E testleri, doğruluk test setinin etiketlenmesi (acentayla birlikte) |
| DevOps / güvenlik | 0,2 TZE | Altyapı, yedekleme, izleme, gizli anahtar yönetimi |
| Acenta tarafı ürün sahibi | 0,3 TZE | Kural tablosu, müşteri kuralları, veri doğrulama, kabul testleri |
| Avukat (dış) | Saat bazlı | KVKK aydınlatma/rıza metinleri, yurt dışı aktarım sözleşmesi, sözleşme şablonu |

## 4. Takvim (haftalar)

Toplam **18–22 hafta**, yaklaşık 4,3 TZE → **75–95 kişi-hafta**.

```
Hafta:            1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22
0 Hazırlık        ███                                                          (ölçüm, başvurular, altyapı)
1 Çekirdek            ███████                                                  (şema, RLS, audit, auth, kurallar)
2 Intake + mail           ███████                                              (Adım 0, Gmail/Graph, proje kodu)
3 Karar kutusu                ███████                                          (PWA, push, WebAuthn)
4 RFQ + link                      ████████                                     (Adım 1, token, form, takip)
5 Okuma + fiyat                       ████████                                 (parse, doğrulama, fiyat geçmişi)
6 Karşılaştırma                           ██████                               (Adım 2, normalizasyon, pazarlık)
7 Teklif                                      ████████                         (Adım 3–4, PDF, online onay)
8 Sözleşme                                            ████████                 (Adım 5, fark, kilit, taahhüt)
9 WhatsApp                            ████████                                 (paralel, başvuru 1. haftada)
10 Veri yükü + doğruluk                               ████████                 (12–18 ay, etiketleme, eşik)
11 Pilot (canlı)                                                  ████████████  (gerçek projeler, sıkılaştırma)
```

| Kilometre taşı | Hafta | Kabul ölçütü |
|---|---|---|
| M0 Başlangıç ölçümü | 2 | Son 3 ayın talep → teklif süreleri, mevcut kayıtlardan elle çıkarılmış olarak hazır (§12: "ilk iş ölçmek") |
| M1 Çekirdek | 5 | RLS katalog testi ve izolasyon testleri yeşil; audit ve silme yasağı aktif |
| M2 Talep → RFQ | 10 | Gerçek bir mail talebinden proje kodu, eksik soru taslağı ve onaylı RFQ gönderimi |
| M3 Teklif | 15 | Teklif bloklama kuralları, PDF, online onay ve açılma takibi çalışıyor |
| M4 Sözleşme | 17 | Fark raporu test setinde; imza sonrası kilit ve borç/alacak kaydı |
| M5 Pilot sonu | 22 | Talep → teklif medyanı ≤ 2 iş günü; pilot projelerde sözleşme–teklif farkı 0 |

**Takvim riskleri:**

- WhatsApp onayı ve Google/Microsoft uygulama izni gecikebilir (mail entegrasyonu dahili uygulama olarak kurulursa risk düşüktür).
- Geçmiş verinin temizlenmesi tahminden uzun sürebilir. PRD §14 "kirli veri" riski geçerlidir; veri yükü, kapsam daraltılarak (yalnızca konaklama ve salon kalemleri) korunabilir.
- Doğruluk hedefleri ilk ölçümde tutmazsa okuma işi daha fazla insan doğrulamasıyla canlıya alınır, takvim kaymaz.

## 5. Geliştirme maliyeti (varsayımlı)

Kesin maliyet ekip modeline (iç kadro, freelance, ajans) bağlıdır. Aşağıdaki tablo **formül ve varsayım** olarak okunmalıdır.

| Varsayım | Değer |
|---|---|
| Kişi-hafta | 75–95 |
| Harmanlanmış kişi-hafta maliyeti (TR, kıdemli ağırlıklı, işveren maliyeti dahil) | €900–2.000 |
| **Geliştirme toplamı** | **≈ €70.000–190.000** |
| Ek: avukat (KVKK + şablon) | €3.000–10.000 [Doğrulanmalı] |
| Ek: tasarım (mevcut prototip üzerine) | Kişi-haftaya dahildir |

Kur varsayımı: **1 EUR ≈ 50–60 TRY** (Kasım 2026 için planlama varsayımıdır, **güncellenmelidir**). Buna göre geliştirme toplamı yaklaşık **3,5–11 milyon TRY** aralığındadır.

## 6. Aylık işletme maliyeti — tek acenta (Faz 1)

**Hacim varsayımları:** Ayda 30 talep (kaybedilenler dahil), 8–12 kullanıcı, 2–3 GB/ay yeni belge.

| Kalem | Aylık (EUR) | Varsayım / not |
|---|---|---|
| Uygulama sunucusu (API ×2, worker, statik PWA) | 40–150 | Küçük VM'ler veya konteyner platformu. TR veri merkezi seçilirse fiyatlar sağlayıcıya göre değişir [Doğrulanmalı] |
| Yönetilen PostgreSQL 16 (PITR dahil) | 60–250 | 2 vCPU / 4–8 GB. Sıcak yedek (HA) eklenirse yaklaşık ×2 |
| Nesne deposu + yedek kopyaları | 5–30 | < 100 GB, şifreli, sürümlü, coğrafi kopya |
| İzleme, log, hata takibi | 0–60 | Ücretsiz katmanlar başlangıçta yeterlidir |
| E-posta (Gmail API / Graph) | 0 | Mevcut Workspace/M365 lisansları kullanılır; API ek ücretsizdir (kota dahilinde) |
| WhatsApp Business API | 10–80 | BSP platform ücreti (0 ile birkaç on EUR arası) + Meta'nın mesaj başı ücreti. Müşteri hizmeti penceresi içindeki yanıtlar genelde ücretsizdir; şablon mesajları kategori ve ülkeye göre ücretlendirilir. **TR fiyatları Meta fiyat tablosundan doğrulanmalı** |
| SMS (saha ekstra onay linki) | 5–20 | TR SMS sağlayıcısı, düşük hacim |
| Konuşma tanıma | 1–15 | 100–300 dakika/ay. Dakika başı yaklaşık $0,005–0,03 [Doğrulanmalı] |
| **Yapay zekâ (Claude)** | **75–250** | Hesap aşağıda (§7) |
| Alan adı, TLS, WAF | 0–30 | |
| **Toplam** | **≈ €200–900 / ay** | ≈ 10.000–54.000 TRY (kur varsayımıyla) |

## 7. Proje başına yapay zekâ maliyeti

**Fiyat girdileri** (Anthropic birinci taraf API liste fiyatı, Kasım 2026 itibarıyla; değişebilir, faturalamadan önce doğrulanmalı):

| Model | Giriş $/MTok | Çıkış $/MTok | Not |
|---|---|---|---|
| `claude-sonnet-5-5` | 2,00 | 10,00 | Önbellek okuma $0,10/MTok |
| `claude-haiku-5-5` | 0,10 | 0,50 | 100K token üstü istemde daha yüksek fiyat |

**Hesaplama varsayımları:**

- Örnek proje: 80 kişi, 5 kalem, kalem başına 4 tedarikçi, kazanılmış.
- Düşünme (thinking) token'ları çıkış olarak faturalanır ve tabloya dahildir. Ayıklama işlerinde `effort: low` kullanılır.
- PDF sayfası yaklaşık 1,5–3 bin token tutar.

| İş | Adet | Giriş tok. (her biri) | Çıkış tok. (her biri) | Model | Yaklaşık $ |
|---|---|---|---|---|---|
| Gelen mesaj sınıflandırma / projeye bağlama | 60 | 1.500 | 100 | Haiku | 0,01 |
| Talep ayıklama | 2 | 4.000 | 1.500 | Sonnet | 0,05 |
| Tedarikçi teklifi okuma (sürümler dahil) | 26 | 8.000 | 3.000 | Sonnet | 1,20 |
| Kritik alanlarda ikinci okuma (04 §4 s6) | ~10 | 8.000 | 1.500 | Sonnet | 0,30 |
| Sözleşme okuma | 4 | 25.000 | 5.000 | Sonnet | 0,40 |
| Fatura okuma (yalnız PDF; XML'de LLM yok) | 6 | 5.000 | 1.500 | Sonnet | 0,15 |
| Taslaklar (RFQ, pazarlık, takip, kapak) | 40 | 3.000 (çoğu önbellekte) | 800 | Sonnet | 0,40–0,55 |
| "Bu projeye sor" / know-how | 15 | 12.000 | 600 | Sonnet | 0,45 |
| Sesli komut niyeti, kontrol listesi, üslup | — | — | — | Haiku/Sonnet | 0,05 |
| **Ara toplam** | | | | | **≈ $3,0** |
| Tekrar denemeler ve hata payı (×1,3) | | | | | **≈ $4,0** |

**Sonuç:** Kazanılan proje başına **≈ $3–6 (≈ €3–5,5)**. Kaybedilen talepte (sözleşme ve fatura yok) **≈ $1,5–2,5**. Ayda 30 talep (≈ %40 kazanma oranı) için **≈ €75–150**. "Bu projeye sor" yoğun kullanılırsa veya büyük kongre projeleri gelirse **€250**'ye çıkabilir.

**Maliyet düşürme kaldıraçları:**

- İstem önbelleği (sabit sistem istemi + şema + üslup örnekleri).
- Acil olmayan işlerde (kapanış analizi, aylık üslup özeti, değerlendirme koşuları) Message Batches API (yaklaşık %50 indirim).
- XML e-faturada LLM atlanır.
- Sınıflandırma Haiku'ya verilir.
- Effort ayarı iş türü bazında yapılır.

Gerçek tüketim `ai_actions.tokens_in/out/cost_usd` alanlarında izlenir. Acenta bazında aylık bütçe alarmı kurulur.

## 8. SaaS aşamasında acenta başına maliyet (Faz 3)

| Bileşen | Acenta başı aylık (EUR) | Not |
|---|---|---|
| Yapay zekâ | 50–350 | Hacme bağlıdır: 20–80 talep/ay |
| WhatsApp (mesaj ücreti; BSP hesabı acenta başınadır) | 10–80 | Acentanın kendi numarası ve WABA hesabı |
| Depolama ve yedek | 5–20 | |
| Paylaşımlı altyapı payı (DB, uygulama, izleme) | 20–80 | Çok kiracılı tek kurulum; 10+ acentada birim maliyet düşer |
| Destek ve operasyon | 30–100 | Kurulum sonrası destek, kural ayarı |
| **Marjinal toplam** | **≈ €115–630** | |

**Platform sabit giderleri** (acenta sayısına bölünür):

- Yüksek erişilebilirlikli veritabanı ve felaket kurtarma (DR).
- Yıllık sızma testi.
- Google kısıtlı kapsam (restricted scope) güvenlik değerlendirmesi: herkese açık Gmail entegrasyonu için yıllık zorunlu olabilir [Doğrulanmalı].
- Microsoft yayıncı doğrulaması.
- Hukuki uyum.

Tahmini toplam **€1.000–3.000/ay** [Doğrulanmalı].

**Fiyatlama önerisi:** Acenta aboneliği marjinal maliyetin en az 2–3 katı olmalıdır. Yapay zekâ tüketimi "dahil kota + aşım" modeliyle fiyatlanmalıdır, çünkü yoğun kullanan acenta maliyeti doğrusal artırır.
