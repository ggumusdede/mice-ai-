# MICE AI Operations OS — çalışma kuralları (Claude / geliştirici ajanlar için)

Bu repo, ürün sahibinin PRD'sine (MICE_AI_Operations_OS, şu an **v0.4**) göre geliştirilir. Yeni PRD sürümleri (v0.5, v0.6 …)
geldikçe geliştirme bu sürümlere göre devam eder.

## Değişmez kural: ana çatıyı sormadan bozma
- Aşağıdaki "ana çatı" kararları ürün sahibine **sorulmadan değiştirilmez**. Yeni bir PRD sürümü veya bir görev bunlarla
  çelişiyorsa: işi durdur, çelişkiyi (mevcut kurgu ↔ yeni istek, etkilenen dosyalar, seçenekler) ürün sahibine sor, cevaba göre ilerle.
- Çelişmeyen, ek (additive) değişiklikler serbesttir; yine de testleri yeşil tut.

### Ana çatı (mimari kararlar)
1. Monorepo: `packages/shared` (tipler + HTTP sözleşmesi `api.ts`), `packages/domain` (saf iş kuralları), `packages/ai`
   (Claude + deterministik mock), `apps/api` (Fastify + PostgreSQL), `apps/web` (React + Vite PWA), `apps/mobile` (aynı web kodunu Capacitor ile saran
   iOS/Android mağaza uygulaması — ürün sahibi kararı 23.11.2026; ayrı mobil kod tabanı yok). Sözleşme değişiklikleri **eklemeli**.
2. Veri: PostgreSQL, her kayıtta `tenant_id`, FORCE RLS (`apply_standard_policies`), kiracı-kapsamlı FK (`apply_tenant_foreign_keys`),
   uygulama `mice_app` (süper kullanıcı değil) rolüyle `withTenant` içinde çalışır.
3. Silinmez kayıt + append-only `audit_log`; DELETE yok (durum alanları kullanılır).
4. Tek doğru kaynak: belgeler veriden üretilir; veri değişince bağlı belgeler `stale` olur ve yeniden üretilmeden gönderilemez.
5. Onay kapıları karar kutusu (`decisions`) üzerinden; para/sözleşme/teklif onayında biyometrik (WebAuthn) step-up.
6. AI yetkisi kapalı liste (`packages/shared/src/ai-authority.ts`); yasak işlemler hem kodda hem DB guard'larında engelli;
   AI yalnız `aiGate` / `createAiService` üzerinden; dışarıya giden her mesaj insan onaylı ve insanın adresinden.
7. Para birimi: her acenta ana para birimini (TL / EUR / USD) kendisi seçer ve değiştirebilir; değişiklik yeni projelere
   uygulanır, her proje oluşturulduğu andaki ana para birimiyle sabittir, raporlar çevrimle gösterir (ürün sahibi kararı
   22.11.2026, S-19 — önceki hali: "iç para birimi EUR"). Markup (Kâr÷Alış) ve marj (Kâr÷Satış) her yerde ayrı.
8. Kurallar/eşikler kodda değil `rules` tablosunda (yönetici değiştirir); `DEFAULT_RULES` yalnız varsayılan.
9. KVKK: misafir PII şifreli, rıza bazlı saklama, misafir verisi modele gönderilmez.

## Çalışma düzeni
- Her değişiklikten sonra: `npm run typecheck`, `packages/domain`, `packages/ai`, `apps/api`, `apps/web` vitest, `vite build`,
  ve iki tarayıcı senaryosu (`e2e/steps0-5.mjs`, `e2e/steps6-8.mjs`, ayrıca `e2e/` altındaki diğer senaryolar) yeşil olmalı.
- Yeni tablo: `apply_standard_policies('t')` + `apply_tenant_foreign_keys()`. Yeni migration numarası çakışmamalı.
- Açık ürün kararları `[Ürün kararı]`, hukuki/tedarikçi doğrulaması gerekenler `[Doğrulanmalı]` olarak dokümanda işaretlenir;
  ürün kararları kodda acenta kuralı (ayar) olarak, temkinli varsayılanla uygulanır.
- Dokümantasyon Türkçe (`docs/`); durum tablosu `docs/README.md` "Uygulama durumu" güncel tutulur.
