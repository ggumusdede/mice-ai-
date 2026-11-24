# Tarayıcı senaryoları

Playwright (headless Chromium) ile **çalışan** sunuculara karşı koşan uçtan uca arayüz senaryoları. Hepsi birden:
`node e2e/run-all.mjs` (kurulum ve ortam değişkenleri: [README — Tüm tarayıcı senaryoları](../README.md#tüm-tarayıcı-senaryoları-e2erun-allmjs)).
Her senaryo kendi projesini açar (aynı veritabanında tekrar koşulabilir); ön koşullar API ile hazırlanır, test edilen kısım arayüzden
sürülür. Ekran görüntüleri `SHOTS/<senaryo>-*.png` (deviceScaleFactor 1).

| # | Betik | PRD | Doğrulanan |
|---|---|---|---|
| — | `steps0-5.mjs` | §7 Adım 0–5 | intake → atama → RFQ → tedarikçi formu → karşılaştırma / pazarlık → 2 seçenekli teklif → onay → müşteri kabulü → sözleşme → imza |
| — | `steps6-8.mjs` | §7 Adım 6–8 | fatura bilgisi düzeltme → operasyon, rooming / KVKK, saha ekstrası, finans, banka, kapanış, anket, rapor, kurallar, vekâlet |
| 1 | `scenarios/01-revision-loop.mjs` | §7 Adım 4 | müşteri `/q/` üzerinden kişi sayısı revizyonu ister → proje Adım 1'e (RFQ) döner, v1 "Revizyon istendi" + görev → v2 oluşturucuda → yönetici onayı → gönderim → eski link 410, v2 kabul → "Kazanıldı" |
| 2 | `scenarios/02-lost-project.mjs` | §7 Adım 4 | "Kaybedildi" alt panelinde gerekçe zorunlu (boş / boşluk → pasif) → Açık filtresinden ve saha panelinden düşer → haftalık rapor "Kayıp nedenleri" gerekçeyi 1 sayar |
| 3 | `scenarios/03-delegation.mjs` | §17.1 | yönetici `/yonetim/vekalet`te ops'a bugün için vekâlet → ops ödeme kartını görür, "Vekil olarak onaylıyorsunuz", onaylar; akreditasyon kartını görmez → vekâlet bitince kart görünmez, API 403 |
| 4 | `scenarios/04-candidate-supplier.mjs` | §7 Adım 1, §17.1 | ops kalem kartından aday tedarikçi ekler → kısa listede "Aday" → RFQ + `/s/rfq/` teklifi → oluşturucu "Aday tedarikçi" işaretler, teklif bloklanır → akreditasyon talebi → yönetici karar kutusundan "Akredite et" → aynı teklif geçer |
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
| 19 | `scenarios/19-quick-approval.mjs` | v0.5 S-01 | 390 px: 3 hazır mesaj kartı → "N mesaj onay bekliyor" toplu kartı → "Tek tek bak" yalnız mesajlar → bir kart "Tek dokunuşla gönder", kalanı "Hepsini onayla" → her biri ayrı onaylı karar, gönderildi |
| 20 | `scenarios/20-handover.mjs` | v0.5 K-05 | yönetici planlı devri (şimdi) başlatır → ayrılanın oturumu 401, proje devralana geçer → devralan "Benim panom" → paketi açar, "Okudum" → %100 tamamlandı |
| 21 | `scenarios/21-offline-pack.mjs` | v0.5 S-15 | saha "Çevrimdışı için indir" → depoda yalnız şifreli metin → çevrimdışı liste açılır ve aranır → yönetici iptal eder → çevrimiçi olunca paket silinir |
