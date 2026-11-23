# v0.5 — Ürün sahibi kararları (uzman paneli anketi, 22.11.2026)

Kaynak: [11-uzman-paneli.md](11-uzman-paneli.md) soruları S-01…S-26 + geliştirme soruları. "Panel önerisi" = kabul edilen öneri.

| # | Konu | Karar | Not / etkisi |
|---|---|---|---|
| S-01 | Otomatik dış mesaj | **Hızlı onay** (tek dokunuş, toplu kart, nöbetçi, eskalasyon); otomatik dış mesaj yok | Ana çatı 6 korunur |
| S-02 | Kurumsal WhatsApp/SMS | **Evet, şartlı**: sohbet bir kişiye atanmış, onaylayanın adı mesajda ve kayıtta; katılımcıya mesaj varsayılan kapalı | |
| S-03 | Tedarik derinliği | **Çekirdek**: kontrat fiyatı, allotment, release/attrition, opsiyon 1./2. sıra | Tam modül sonra |
| S-04 | Hedef segment | **Kongre de tam** (PCO dahil): kongre kayıt, yaka kartı, abstract v0.5 kapsamında | ⚠ Panel önerisinden büyük; kapsam ve süre artar |
| S-05 | Barındırma | **AB varsayılan + Kurumsal'da TR seçeneği** | [Doğrulanmalı] avukat |
| S-06 | Kapora önce | **Uyar + gerekçe + Face ID istisna**; acenta blok seçebilir | |
| S-07 | Teklif kur politikası | **Zorunlu alan, kur payı müşteriye gizli** (istenirse madde olarak) | |
| S-08 | Müşteri adı gizleme istisnası | **Açılabilir**: müşteri bazında, anlaşmalı oteller için, yönetici kararı, geri alınabilir | |
| S-09 | Kişisel hesaplar | **Kurumsal varsayılan, yönetici istisna verebilir**; kişisel WhatsApp yalnız "Projeye ilet" | |
| S-10 | Ekip sıralaması | **Yalnız yönetici görür** (isimli sıralama); çalışan sıralamayı görmez | |
| S-11 | Satış primi | **Acenta tercihine bağlı (opsiyonel ayar)**; açan acentada satışçı tahmini primini görür | Kural: `showEstimatedBonus` varsayılan kapalı |
| S-12 | Tedarikçiye söz skoru | **Acenta/proje düzeyi**, kişi sıralamasına girmez | |
| S-13 | Meşgul vekâleti | **Son tarihli kartlar vekile yönlenir**; otomatik onay asla yok | |
| S-14 | Mesai dışı bildirim | **Her zaman (acenta varsayılanı)**; acenta/çalışan isterse sessiz saat açabilir | |
| S-15 | Çevrimdışı PII | **Ad + oda + transfer grubu + telefon**, rol bazlı, şifreli, uzaktan iptal | |
| S-16 | Uçak bileti | **İkisi de**: IATA'lı acenta sistemden (GDS/NDC) bilet keser; IATA'sız acenta bilet acentası üzerinden yürütür (talep/takip/fatura) | ⚠ Panel önerisinden büyük; GDS entegrasyonu + lisans |
| S-17 | Müşteri faturası | **Şimdilik muhasebe programı**; sistemden kesim v0.7+ isteğe bağlı | |
| S-18 | Muhasebe sırası | **Mikro (v0.5 doğrulama) → genel CSV (v0.6) → anketle 2. program** | |
| S-19 | Para birimi | **Acenta seçer (TL/EUR/USD) ve değiştirebilir**; yeni projelere uygulanır | ⚠ **Ana çatı 7 değişti** (CLAUDE.md güncellendi) |
| S-20 | Açık kitap fiyatlama | **v0.6**, komisyonlar yalnız beyan | |
| S-21 | SaaS fiyat | **Kullanıcı bandı + AI kredisi** | Fiyatlar [Doğrulanmalı] |
| S-22 | Ayrılan acentanın verisi | **90 gün salt okunur + dışa aktarım → kripto silme/anonimleştirme**; ek: ücretli **salt okunur arşiv aboneliği** (bağlılık değerle sağlanır, veri rehin tutulmaz) | [Doğrulanmalı] avukat (KVKK, veri işleyen) |
| S-23 | Dönem kilidi | **v0.6, düzeltme belgesiyle** | |
| S-24 | Acentalar arası kıyas | **Önce hukuki görüş** (4054 + KVKK); uygunsa v0.7, açık onay + toplu anonim veri | |
| S-25 | Ses | **Varsayılan kapalı**, v0.6'da sunucu tarafı STT | |
| S-26 | 17 temkinli varsayılan | **Paket onay** | 11-uzman-paneli.md |
| D-1 | Kabul edilmiş teklif revizyonu | **Revize edilebilir** (Rev.N, müşteri yeniden onaylar); sözleşme varsa ek protokol akışıyla bağlanır | Mevcut 409 `QUOTE_ACCEPTED` kaldırılacak |
| D-2 | Teklif kalitesi metrikleri | **Teklifi hazırlayan + onun küçük çekirdek ekibi** | Yeni "ekip (alt takım)" kavramı |
| D-3 | İlk yüklemede satış sorumlusu | **Evet**, isteğe bağlı sütun, kullanıcıyla eşleştirme | |

| M-1 | Mobil | **Mağaza uygulaması**: mevcut web uygulaması Capacitor ile iOS/Android'e sarılır, App Store / Google Play'e konur (yerel Face ID, APNs/FCM bildirim, güçlü çevrimdışı). v0.5-A'dan sonra. Apple/Google geliştirici hesabı gerekir | 23.11.2026; docs/08 güncellenecek; ana çatı 1'e `apps/mobile` eklendi |

## Kapsam etkisi
Panelin v0.5 tahmini (≈95–110 geliştirici-haftası) üç büyütmeyle artar: S-04 tam kongre (+≈15–25), S-16 GDS ile bilet kesimi (+≈15–20, lisans/sertifikasyon süresi hariç), S-19 acenta para birimi (+≈4–6). Önerilen sıralama `docs/11` §v0.5 tablosunda güncellenecek; GDS ve kongre kaydı için ayrı alt fazlar (v0.5-A çekirdek, v0.5-B kongre, v0.5-C bilet) önerilir.
