# 08 — Mobil Karar: PWA mı, Küçük iOS Uygulaması mı? (§19.6)

> PRD karşılığı: §13 açık konu #8, §15 (onay hareketi: tek dokunuş + Face ID; bildirim: kritik anında, rutin günde iki özet), §18.1.

## Karar

**Önce PWA.** Yönetici karar kutusu, ekip ekranları, saha paneli ve public sayfalar tek React PWA kod tabanında geliştirilir. Aşağıdaki **tetikleyici kriterlerden biri** gerçekleşirse yalnızca yönetici onay ekranları için **küçük bir yerel (native) iOS uygulaması** yapılır.

## 1. Gereksinim × PWA karşılaması

| Gereksinim (§15) | PWA'da nasıl | Yeterlilik |
|---|---|---|
| Tek dokunuş + Face ID onayı | WebAuthn: `navigator.credentials.get({ publicKey: { challenge, allowCredentials, userVerification: 'required' } })`. Sunucu tarafında `@simplewebauthn/server` kullanılır. Challenge, karar kimliği ve karar içeriğinin özetine bağlanır, böylece onaylanan şey kart içeriğiyle kriptografik olarak eşleşir | ✅ Yeterli |
| Onay kaydı: kim / ne zaman / hangi cihaz | `decisions.decided_by`, `decided_at`, `webauthn_credential_id`, `decided_device` (cihaz etiketi + user-agent) | ✅ Yeterli. Passkey'ler iCloud ile senkronize olabildiği için "cihaz" bilgisi **kimlik bilgisi** düzeyindedir, donanım düzeyinde değildir. Gerekirse kayıt sırasında `backed_up` bayrağı kontrol edilir |
| Kritik bildirim anında | Web Push (VAPID). iOS/iPadOS 16.4+ ve yalnızca ana ekrana eklenmiş uygulamada | ⚠️ Kısmi. Teslim garantisi yok, "Time Sensitive / Critical" seviyesi yok, Odak (Focus) modları bildirimi bastırabilir |
| Rutin onaylar: sabah/akşam özet | Sunucu tarafında zamanlanmış özet push + e-posta | ✅ Yeterli |
| Uygulama simgesinde sayaç | Badging API (iOS 16.4+, ana ekran uygulaması) | ✅ Yeterli |
| Hızlı açılış ve "uygulama hissi" | Standalone görünüm, önbellekli kabuk | ✅ Yeterli |
| Bildirimden doğrudan onay (uygulamayı açmadan) | Web Push'ta etkileşimli bildirim eylemleri yok | ❌ Yok. Bildirime dokunmak kartı açar; Face ID ile onay 2 dokunuşta tamamlanır |

## 2. Faz 1'de PWA riskini azaltan önlemler

1. **Kurulum akışı:** İlk girişte "Ana ekrana ekle" adım adım rehberi gösterilir. Bildirim izni yalnızca kurulumdan sonra ve bir düğmeye basılınca istenir.
2. **Kritik bildirim yedeği:** Kritik karar kartı (opsiyon bitimi, acil ödeme, sözleşme riski) 15 dakika içinde açılmazsa aynı içerik **WhatsApp şablonu veya SMS** ile kısa bir link olarak gönderilir. Link uygulamayı açar; onay yine Face ID ister.
3. **Ölçüm:** `push_deliveries` kaydı tutulur (gönderildi / tıklandı / süre). Push aboneliğinin düşmesi izlenir: iOS bazı durumlarda aboneliği geçersiz kılabilir; bu durumda yeniden abone olma istemi gösterilir.
4. **Masaüstü yedek:** Aynı karar kutusu masaüstü tarayıcıda da çalışır. Face ID yoksa Touch ID veya Windows Hello kullanılabilir.

## 3. Yerel iOS uygulamasını tetikleyen kriterler

Pilot boyunca (en az 8 hafta) ölçülür. **Herhangi biri** gerçekleşirse yerel uygulama başlatılır:

| # | Kriter | Eşik |
|---|---|---|
| K1 | Kritik bildirimlerin push ile **5 dakika içinde** görülme oranı | < %90 (yedek SMS/WA'ya düşme oranı > %10) |
| K2 | Push aboneliğinin kendiliğinden düşmesi | Ayda 1'den fazla |
| K3 | Yönetici, kilit ekranından veya bildirimden **doğrudan** onay ister (uygulamayı açmadan) | Ürün talebi |
| K4 | Odak modunu delen **Time Sensitive** veya kritik bildirim ihtiyacı | Ürün talebi |
| K5 | Widget veya Live Activity (ör. "bekleyen 3 karar", etkinlik günü canlı durum) | Ürün talebi |
| K6 | SaaS satışında App Store varlığı ticari gereklilik haline gelir | Satış geri bildirimi |
| K7 | Bir iOS sürüm değişikliği PWA push veya WebAuthn davranışını bozar | Olay |

## 4. Yerel uygulama olursa: kapsam ve maliyet

**Kapsam (bilinçli olarak küçük):** Giriş, karar kutusu listesi, kart detayı, Face ID ile onay/düzelt/reddet, bildirim eylemleri, rozet. Proje ekranları ve diğer işlevler uygulama içinde web görünümüyle (PWA) açılır.

| Seçenek | Açıklama | Tahmini efor |
|---|---|---|
| **A. SwiftUI yerel uygulama** (önerilen) | LocalAuthentication (Face ID), APNs (time-sensitive bildirim, bildirim eylemleri), mevcut REST API (`/api/decisions`) | 1 iOS geliştirici × 5–8 hafta + backend'de APNs gönderimi ve cihaz kaydı (1–2 hafta) |
| B. Capacitor sarmalayıcı | Mevcut React kodu sarmalanır; Face ID ve push için eklentiler kullanılır | 3–5 hafta. Daha az yerel his; App Store incelemesinde "salt web sarmalayıcı" reddi riski var [Doğrulanmalı] |

**Sürekli maliyetler:** Apple Developer Program yıllık üyeliği [Doğrulanmalı: güncel ücret], her iOS sürümü için bakım (yılda 1–2 hafta), App Store inceleme süreci. Dağıtım tek acenta için TestFlight veya özel dağıtım (Apple Business Manager / Custom Apps) ile yapılabilir; SaaS'ta herkese açık App Store'a geçilir.

**Güvenlik eşdeğerliği:** Yerel uygulamada onay, Secure Enclave'de üretilen ve Face ID ile korunan bir cihaz anahtarıyla imzalanır. Sunucu bu imzayı WebAuthn assertion'ı ile **aynı karar kaydı modeline** yazar (`DecisionInput.biometric.method` alanına `'device_key'` eklenir). Audit modeli değişmez.

## 5. Özet

| | PWA (Faz 1) | Yerel iOS (tetiklenirse) |
|---|---|---|
| Face ID onayı | ✅ WebAuthn | ✅ LocalAuthentication / Secure Enclave |
| Kritik bildirim güvencesi | ⚠️ Push + SMS/WA yedeği | ✅ APNs time-sensitive + eylemler |
| Ek maliyet | Yok | ≈ 6–10 kişi-hafta + yıllık üyelik + bakım |
| Kod tabanı | Tek | +1 küçük Swift projesi |

**Öneri:** Faz 1 PWA + kritik bildirim yedeği. Pilotun 8. haftasında K1–K7 değerlendirilsin; tetiklenirse yerel uygulama Faz 2'ye paralel 6–10 haftalık iş olarak eklensin.
