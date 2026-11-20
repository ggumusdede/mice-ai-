# MICE AI Operations OS — Mühendislik Dokümanları

Bu klasör, Ürün Gereksinim Dokümanı (PRD) v0.4'ün **§18 "Mühendise açık sorular"** (17 soru) ve **§19 "Mühendislik tarafından beklenen sonraki teslimatlar"** (6 teslimat) bölümlerine mühendislik cevabıdır.

Dokümanlar repodaki kod sözleşmesine dayanır:

| Kaynak | İçerik |
|---|---|
| `packages/shared/src/enums.ts` | Roller, adımlar (0–8), statüler, karar kartı türleri |
| `packages/shared/src/models.ts` | Varlık şekilleri (API JSON) |
| `packages/shared/src/api.ts` | HTTP API sözleşmesi |
| `packages/shared/src/ai-authority.ts` | §6 kapalı yapay zekâ yetki listesi |
| `packages/shared/src/rules.ts` | Acenta bazlı varsayılan kural/eşik değerleri |
| `packages/domain/src/*.ts` | Saf iş kuralı fonksiyonları (birim testli) |
| `packages/ai/src/index.ts` | `AiService` arayüzü (Claude + deterministik mock) |

## İçindekiler

| # | Doküman | PRD karşılığı | Özet |
|---|---|---|---|
| 01 | [Mimari](01-mimari.md) | §3, §7, §11 | Bileşenler, 0–8 veri akışı, tasarım ilkelerinin teknik uygulanışı |
| 02 | [Veri modeli](02-veri-modeli.md) | §19.1, §18.11, §18.13 | Tablolar, RLS kalıbı, silinmezlik, belge bağımlılıkları, izolasyon testi |
| 03 | [Yapay zekâ yetki matrisi](03-yapay-zeka-yetki-matrisi.md) | §19.2, §6 | Her işlem → servis/fonksiyon → izin → onay ekranı |
| 04 | [Doğruluk ölçümü](04-dogruluk-olcumu.md) | §19.3, §18.9 | Hedefler, test veri seti, güven eşiği kalibrasyonu, hata kaydı |
| 05 | [Faz 1 teknik planı](05-faz1-teknik-plan.md) | §19.4, §18.17 | Entegrasyon sırası, ekip, takvim, işletme maliyeti, SaaS birim maliyeti |
| 06 | [Otomasyon terfisi](06-otomasyon-terfisi.md) | §19.5, §18.12, §16 | Sayaç, 20 temiz onay, 1/20 örneklem, otomatik geri dönüş |
| 07 | [Mühendislik cevapları](07-muhendislik-cevaplari.md) | §18 (1–17) | 17 sorunun tamamına somut öneri |
| 08 | [Mobil karar](08-mobil-karar.md) | §19.6, §18.1 | Önce PWA; yerel iOS uygulamasını tetikleyen kriterler |

## Okuma kılavuzu

- **Acenta yönetimi:** 07 (cevaplar), 05 (maliyet/takvim), 08 (mobil karar).
- **Geliştirici:** 01 → 02 → 03 → 06 → 04.
- **Avukat / KVKK danışmanı:** 07 §2 ve §15, 02 "Kişisel veri katmanı".

## İşaretleme kuralları

- **[Doğrulanmalı]** — üçüncü taraf ürün yeteneği, fiyat veya mevzuat yorumu. Karar vermeden önce satıcıdan veya avukattan teyit alınmalıdır.
- **[Ürün kararı]** — teknik olarak her iki yol da mümkün; acenta yönetiminin seçmesi gerekir.
- Tutarlar **aralık ve varsayım** olarak verilmiştir. Kesin fiyat iddiası yoktur. Kur varsayımı (EUR/TRY) 05'te açıkça belirtilmiştir.
