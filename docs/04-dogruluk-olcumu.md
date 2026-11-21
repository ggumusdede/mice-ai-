# 04 — Belge Okuma Doğruluğu ve Güven Eşikleri (§19.3, §18.9)

> PRD karşılığı: §6 (güven puanı), §7 Adım 1/5/7 (teklif, sözleşme, fatura okuma), §14 (yapay zekâ okuma hataları), §16.4 (düzeltme = öğrenme).

## 1. İlke: "Doğruluk" iki ayrı sayıdır

| Ölçüt | Tanım | Neden önemli |
|---|---|---|
| **Ham doğruluk** | Tüm alanlar içinde modelin doğru çıkardığı alanların oranı | İnsan doğrulama yükünü belirler |
| **Sızan hata oranı** (güvenli hata) | Güven eşiğinin **üstünde** olduğu için insana gösterilmeden kabul edilen alanlardaki hata oranı | İş riskini belirler. Asıl hedef budur |

Sistem %100 ham doğruluk vaat etmez. Vaat ettiği şudur: **eşik üstünde kabul edilen değerler hedef hata oranının altında kalır, geri kalanı insana gider.**

## 2. Alan türüne göre hedefler (başlangıç önerisi)

Hedefler pilot öncesi test setinde ölçülür ve gerekirse acenta yönetimiyle revize edilir. Bu değerler **öneridir**; gerçek performans Türkçe tedarikçi belgelerinin çeşitliliğine bağlıdır ve ölçülmeden garanti verilemez.

| Alan türü | Örnekler | Ham doğruluk hedefi | Eşik üstü sızan hata hedefi | Karşılaştırma yöntemi |
|---|---|---|---|---|
| **Para (kritik)** | Birim fiyat, toplam, KDV tutarı, ön ödeme oranı | ≥ %95 | **≤ %0,5** | Sayısal, tolerans 0,01 |
| **Miktar ve sayı** | Kişi, oda sayısı, gece, garanti sayısı | ≥ %95 | ≤ %1 | Tam eşleşme |
| **Tarih** | Giriş/çıkış, opsiyon tarihi, vade | ≥ %95 | ≤ %1 | ISO tarih tam eşleşme |
| **Kod / kategori** | Para birimi, oda tipi (SGL/DBL), pansiyon (BB/HB/FB), KDV dahil/hariç bayrağı | ≥ %93 | ≤ %1 | Normalleştirilmiş sözlükle tam eşleşme |
| **Kalem satırları** | Teklif ve fatura satırları (açıklama + miktar + fiyat) | Satır F1 ≥ 0,90 | ≤ %1 satır | Satır eşleştirme (Hungarian) + alan bazlı karşılaştırma |
| **Koşul metinleri** | İptal, attrition, ödeme, overtime | Doğru sınıf ≥ %85 | ≤ %3 | Metin → yapılandırılmış sınıf (ör. "30 gün öncesine kadar ücretsiz") ve anlamsal eşleşme. Ayrıca LLM-yargıç ve insan örneklemi |
| **Kimlik bilgisi** | Fatura no, VKN, tedarikçi adı | ≥ %97 | ≤ %0,5 | Tam eşleşme (VKN için checksum kontrolü) |
| **Talep ayıklama** | §7 Adım 0 alanları | ≥ %90 | ≤ %2 | Alan bazlı |

**e-Fatura (UBL-TR XML):** XML geldiğinde LLM kullanılmaz; deterministik ayrıştırıcı çalışır ve hedef %100'dür. LLM yalnızca PDF, görsel veya serbest metin için kullanılır.

## 3. Test veri seti

### Kaynak ve kapsam

PRD §8, ilk veri yükü olarak son 12–18 ayın kapanmış projelerini öngörür. Aynı havuzdan:

| Belge türü | Hedef adet (Faz 1) | Çeşitlilik gereksinimi |
|---|---|---|
| Tedarikçi teklifi | 120–200 | E-posta gövdesi, PDF (metin + taranmış), Excel, WhatsApp ekran görüntüsü. En az 25 farklı tedarikçi. TR / EN / RU. Paket fiyat ve kalem fiyat örnekleri |
| Sözleşme | 40–60 | Acenta şablonu ve tedarikçi şablonu. Ek protokoller. Boş alanlı örnekler (bilinçli olarak dahil edilir) |
| Tedarikçi faturası | 80–120 | e-Fatura PDF görünümü, UBL XML, e-Arşiv, yabancı fatura |
| Banka ekstresi | 10–20 dosya | Acentanın kullandığı her bankanın CSV/XLSX biçimi |
| Talep (mail/WA/not) | 100–150 | Eksik bilgili, çok dilli, esnek tarihli örnekler |

### Hazırlık süreci

1. **Seçim:** Kapanmış projelerden tabakalı örnekleme yapılır: belge türü × kaynak biçimi × dil × tedarikçi.
2. **KVKK:** Belgeler önce takma adlandırılmış kopyaya dönüştürülür (kişi adı, telefon, e-posta). Kurumsal ve fiyat verisi korunur. Set acentanın kendi ortamında saklanır.
3. **Altın etiket (gold):** Her belge iki kişi tarafından bağımsız etiketlenir (acentadan bir ekip üyesi + bir mühendis). Etiketleme yapılandırılmış formla, `ParsedOffer`, `ContractFields` ve `ParsedInvoice` şemalarıyla aynı yapıda yapılır. Uyuşmazlıkta üçüncü kişi hakemlik eder. Etiketleyiciler arası uyum (Cohen κ / alan bazlı uyum) raporlanır; düşük uyumlu alanlar tanım sorunudur, model sorunu değildir.
4. **Bölme:** %30 geliştirme (istem ve eşik ayarı), %70 **dondurulmuş test**. Test seti istem geliştirmede görülmez.
5. **Sürekli büyüme:** Canlı kullanımda insan düzeltmesi yapılan her belge (bkz. §5) aday örnektir. Aylık 20–30 yeni örnek seçilip etiketlenerek test setine eklenir.

### Değerlendirme koşucusu (uygulandı: `packages/ai/eval/`)

```bash
npm run eval -w @mice/ai -- --provider=mock --set=all                 # deterministik mock, ağ yok
npm run eval -w @mice/ai -- --provider=claude --set=offers,invoices   # ANTHROPIC_API_KEY gerekir (AI_MODEL / AI_MODEL_FAST geçerli)
npm run eval -w @mice/ai -- --provider=claude --set=contracts --as-pdf   # metin fikstürleri pdfkit ile PDF'e çevrilir
#   diğer seçenekler: --target=0.95 (hedef kesinlik) --out=<dizin> --fixtures=<dizin> --concurrency=2 --limit=N
```

| Parça | Dosya | Not |
|---|---|---|
| Fikstürler | `eval/fixtures/{requests,offers,contracts,invoices}.json` | 25 **sentetik** belge (9 talep, 7 teklif, 4 sözleşme, 5 fatura; TR/EN/RU; e-posta, WhatsApp, telefon notu, CSV/Excel, e-Fatura/e-Arşiv görünümü, yabancı fatura, eksik alanlı sözleşme). Biçim: `{id, docType, language, source, today, input:{text, channel?, file?}, gold, tags, origin}`. Altın etiketlerde yalnız listelenen alanlar skorlanır; açık `null` = "alan yok olmalı" (uydurulan değer hata sayılır). `<set>.*.json` dosyaları (ör. `offers.exported.json`) otomatik eklenir |
| Koşucu / skor | `eval/harness.ts`, `eval/run.ts` | Alan bazlı karşılaştırma: `exact` (fatura no), `normalized` (ad / şehir: harf katlama, noktalama ve A.Ş./Ltd./ООО/Otel gibi gürültü belirteçleri atılır, eşitlik veya ≥ %60 örtüşen içerme), `code` (para birimi, oda tipi; TL→TRY), `date` (ISO gün), `int`, `money` (±0,01), `rate` (±0,0005), `bool`. Satırlar (teklif satırları, sözleşme odaları) önce açgözlü en-iyi eşleştirmeyle eşlenir (para alanı 2 puan); eşleşmeyen altın satır = eksik (güven 0), fazla tahmin satırı = satır güveniyle **hatalı kabul adayı**. Satır F1 raporlanır |
| Güven | aynı | Alanın güveni: talepte `Extracted.confidence`, teklif/faturada `fieldConfidence[alan]` (satırlarda `lines`, KDV bayrağında `vat`), sözleşmede alan bazlı güven olmadığı için belge güveni. Üretilmemiş değerin güveni 0 (her eşikte insana gider) |
| Rapor | `eval/reports/eval-<sağlayıcı>-<set>.{md,json}` | Belge türü bazında: alan ve alan grubu doğruluğu, kalibrasyon tablosu (0–0,5, 0,5–0,6, …, 0,95–1 aralıkları: n, ortalama güven, gözlenen doğruluk, fark) + ECE, eşik önerisi, dil bazında doğruluk, tüm hatalı alanlar. `eval-mock-all.*` mock taban çizgisidir |
| Test | `packages/ai/test/eval-harness.test.ts` | Mock ile tüm seti çalıştırır; rapor şeklini ve mütevazı tabanı (genel ≥ %80, tür başına ≥ %70, teklif satır F1 > 0,8) doğrular. Claude modu testte çalıştırılmaz |
| Gerçek set | `apps/api/src/scripts/export-eval-set.ts` | `npm run export-eval-set -w @mice/api -- --tenant=<uuid> [--since=YYYY-MM-DD] [--out=…]`: `ai_actions.corrected = true` olan teklif okumaları (kaynak `supplier_offers.raw_text`) ve talep ayıklamaları (kaynak `inbound_messages.body`) için altın = AI çıktısı + insan düzeltmesi (`changes[alan].after`). E-posta, telefon, IBAN, TCKN ve bilinen kişi adları (kullanıcılar, tedarikçi ve müşteri kontakları) takma adlanır; kurum adları ve fiyatlar korunur. Sözleşme / fatura düzeltmeleri kaynak metin saklanmadığı için sayılır ama dışa aktarılmaz. Çıktı acentanın ortamında kalır; iki kişilik etiket kontrolünden (§3 adım 3) geçmeden test setine alınmamalıdır |

**Bugünkü mock sonucu (sentetik set, yönlendirici):** genel ham doğruluk ≈ %91; Rusça talepte bütçe 0,9 güvenle yanlış okunuyor (sızan hata örneği), Rusça teklif satırlarında miktar/gece okunamıyor, Rusça faturada tutarlar karışıyor; PDF modunda mock hiçbir şey okuyamaz (güven 0 → tümü insana). 25 belgeyle hiçbir belge türünde Wilson sınırlı %95 eşiği kanıtlanamıyor — bu beklenen sonuçtur ve gerçek setin neden gerekli olduğunu gösterir.

- **CI kapısı (henüz yok ⛔):** İstem, model veya ayrıştırıcı değişikliği yapan PR, test setinde para alanlarında sızan hata hedefini aşarsa birleştirilemez. Koşucu JSON raporu bunun girdisidir (`byDocType.*.perGroup`, `threshold.leaksAtDefault`).
- Maliyet kontrolü: Değerlendirme, Message Batches API ile (yaklaşık %50 indirimli, asenkron) çalıştırılabilir (koşucu bugün eşzamanlı çağırır, `--concurrency`).

## 4. Güven puanı ve eşik kalibrasyonu

### Güven puanı tek bir sinyal değildir

Modelin kendi beyan ettiği güven puanı tek başına iyi kalibre değildir. Her alan için **birleşik güven** hesaplanır:

| Sinyal | Açıklama | Etki |
|---|---|---|
| s1 Model beyanı | `fieldConfidence[alan]` | Taban değer |
| s2 Şema doğrulama | Tip, aralık, zorunlu alan (zod) | Hata varsa güven 0 |
| s3 Aritmetik tutarlılık | Σ satır = toplam; KDV = matrah × oran; gece = çıkış − giriş | Tutarsızlıkta ilgili alanlar eşik altına düşer |
| s4 Bağlam tutarlılığı | Teklifteki kişi/oda/tarih RFQ ile uyumlu mu? Para birimi tedarikçinin geçmişiyle uyumlu mu? | Sapma güveni düşürür. Değer yine de kaydedilir ve ekrana sapma olarak yansır |
| s5 Kaynak kalitesi | Metin katmanlı PDF mi, taranmış mı? Görsel çözünürlüğü | Taranmış belgede taban düşer |
| s6 İkinci okuma uyumu | Para alanlarında ikinci, farklı istemli okuma (veya kritik belgede daha güçlü bir modelle okuma). İki okuma uyuşmazsa güven düşer | Yalnızca kritik alanlarda maliyet artırır |

`birleşik = f(s1..s6)`. Başlangıçta basit kural tabanlı bir birleşim kullanılır. Yeterli veri biriktiğinde (≥ 1.000 etiketli alan) lojistik regresyon veya isotonic kalibrasyon ile öğrenilir.

### Eşik belirleme yöntemi

Koşucunun uyguladığı (`recommendThreshold`, `eval/harness.ts`): her belge türü için skorlanan alanlar `(güven, doğru/yanlış)` çiftleridir.
Aday eşikler gözlenen güven değerleridir; `τ` için kabul kümesi `güven ≥ τ`, kesinlik = kabul kümesindeki doğru oranı, kapsama = kabul
edilen alan ÷ tüm alanlar. Rapor iki eşik verir: **nokta eşiği** = kesinliği hedefe (varsayılan %95, `--target`) ulaşan en düşük `τ`;
**Wilson eşiği** = kabul kümesindeki hata oranının %95 Wilson üst sınırı `≤ 1 − hedef` olan en düşük `τ` (küçük örneklemde güvenli taraf —
önerilecek olan budur). Hiçbir `τ` hedefe ulaşmıyorsa sonuç `null`'dır: o belge türü tümüyle insana gider (eşik gevşetilmez). Ayrıca
bugünkü varsayılan 0,8 üstünde yanlış olan alan sayısı (`leaksAtDefault`) raporlanır. Önerilen eşik otomatik uygulanmaz; yönetici
`aiConfidenceThreshold` (veya ileride alan türü bazlı anahtar) kuralını değiştirerek yürürlüğe koyar (§6: kural değişikliği insanda).
Aşağıdaki adımlar hedef süreçtir:


1. Geliştirme setinde her alan türü için `(birleşik güven, doğru/yanlış)` çiftleri toplanır.
2. **Güvenilirlik diyagramı** çizilir ve ECE (expected calibration error) hesaplanır.
3. Her alan türü için eşik **hedef sızan hata oranını sağlayan en düşük değer** olarak seçilir: `eşik_t = min{τ : hata(güven ≥ τ) ≤ hedef_t}`. Az örnekli türlerde Wilson güven aralığının üst sınırı kullanılır.
4. Bu eşikteki **kapsama** (insana gitmeyen alan oranı) raporlanır. Kapsama düşükse çözüm eşiği gevşetmek değildir; istem, ön işleme (OCR) veya sinyal iyileştirilir.
5. Eşikler acenta kuralı olarak saklanır. Varsayılan `aiConfidenceThreshold=0.8` yalnızca başlangıç değeridir; alan türü bazında geçersiz kılınabilir (`rules.aiConfidenceThresholds` anahtarı önerilir).
6. Eşikler **üç ayda bir**, canlı düzeltme verisiyle yeniden kalibre edilir. Değişiklik admin onayıyla yürürlüğe girer (§6: kural değişikliği insanda).

### Arayüzde gösterim

- Eşik altı alanlar sarı vurgulanır ve kaynak belgedeki konum (sayfa/satır) yanında gösterilir.
- Doğrulama tek tıklamadır ("doğru") veya düzeltmedir. Her iki eylem de etiket olarak kaydedilir.

## 5. Hata kaydı ve öğrenme

### Kayıt modeli

Önerilen `ai_corrections` tablosu (**henüz yok**; bugün düzeltme `ai_actions.corrected / correction / corrected_by / corrected_at` alanlarında satır bazında tutulur, bkz. 02): `ai_action_id`, `field_path` (ör. `lines[2].unitPrice`), `ai_value`, `human_value`, `ai_confidence`, `correction_kind` (`value` | `missing` | `extra` | `classification`), `corrected_by`, `corrected_at`.

Aşağıdaki durumların **hepsi** bu tabloya kayıt düşer:

- Eşik altı alanın doğrulanması (doğru veya düzeltilmiş).
- Eşik **üstü** bir alanın sonradan düzeltilmesi. Bu bir **sızan hatadır**: öncelikli inceleme listesine girer ve otomasyon sayacında `error_detected` olarak işlenir (bkz. 06).
- Sözleşme farkı kontrolünde ortaya çıkan, okuma kaynaklı yanlış alarmlar.

### Öğrenmenin teknik anlamı

Model ince ayarı (fine-tuning) **yapılmaz**. "Öğrenme" şu üç mekanizmadır:

1. **Örnek havuzu:** Tedarikçi bazında doğrulanmış okumalar saklanır. Aynı tedarikçinin sonraki belgesinde istemde 1–2 örnek (few-shot) olarak kullanılır. Örnekler takma adlıdır ve istem önbelleği (prompt caching) ile maliyet düşük tutulur.
2. **Tedarikçi profili:** Tekrarlayan biçim bilgisi tedarikçi kartına not edilir. Örnek: "fiyatlar KDV dahil yazılır", "Excel'de 2. sayfa konaklama".
3. **Test setinin büyümesi** ve eşiklerin yeniden kalibrasyonu.

### Raporlama

- **Haftalık rapor (§16.6):** Düzeltme oranı ve trendi; alan türü bazında sızan hata; en çok hata yapılan tedarikçi biçimleri.
- **Model/istem sürümü bazında karşılaştırma:** `ai_actions.prompt_version` (önerilen sütun, henüz yok; bugün yalnızca `model` kaydedilir). Bir sürüm değişikliği sonrasında düzeltme oranı artarsa otomatik uyarı üretilir.
