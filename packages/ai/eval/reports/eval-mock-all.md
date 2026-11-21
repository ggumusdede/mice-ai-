# Belge okuma doğruluk raporu — mock (mock-heuristic-v1)

Üretim: 2026-11-21T20:26:11.515Z · Setler: requests, offers, contracts, invoices · Belge: 25 · Skorlanan alan: 326 · Hedef kesinlik: %95.0

**Genel ham doğruluk:** %91.4 · **ECE:** 0.1118

> Ham doğruluk insan doğrulama yükünü, eşik üstü kesinlik (1 − sızan hata) iş riskini gösterir (docs/04 §1). Sentetik set küçük ve yönlendiricidir; eşikler gerçek etiketli set ile yeniden hesaplanmalıdır.

## Eşik önerileri

| Belge türü | n alan | τ (nokta) | Kesinlik | Kapsama | τ (Wilson) | Kapsama | 0,8 üstü hata | Not |
|---|---|---|---|---|---|---|---|---|
| request | 99 | 0.75 | %96.2 | %79.8 | — | — | 3 | Nokta tahmini τ=0.75; Wilson üst sınırıyla hedef bu örnek sayısında (99) kanıtlanamıyor — daha fazla etiketli örnek gerekli. |
| offer | 130 | 0.65 | %97.3 | %83.9 | — | — | 1 | Nokta tahmini τ=0.65; Wilson üst sınırıyla hedef bu örnek sayısında (130) kanıtlanamıyor — daha fazla etiketli örnek gerekli. |
| contract | 57 | 0.76 | %100.0 | %98.3 | — | — | 0 | Nokta tahmini τ=0.76; Wilson üst sınırıyla hedef bu örnek sayısında (57) kanıtlanamıyor — daha fazla etiketli örnek gerekli. |
| invoice | 40 | 0.85 | %100.0 | %85.0 | — | — | 0 | Nokta tahmini τ=0.85; Wilson üst sınırıyla hedef bu örnek sayısında (40) kanıtlanamıyor — daha fazla etiketli örnek gerekli. |

## request — 9 belge, 99 alan, doğruluk %89.9, ECE 0.1359

| Alan | n | Doğru | Doğruluk | Ort. güven |
|---|---|---|---|---|
| budget | 9 | 7 | %77.8 | 0.8 |
| budgetCurrency | 9 | 9 | %100.0 | 0.8444 |
| city | 8 | 6 | %75.0 | 0.6813 |
| customerName | 9 | 7 | %77.8 | 0.7322 |
| decisionDate | 4 | 4 | %100.0 | 0.6 |
| district | 6 | 6 | %100.0 | 0.875 |
| endDate | 9 | 8 | %88.9 | 0.8444 |
| language | 9 | 8 | %88.9 | 0.8733 |
| pax | 9 | 9 | %100.0 | 0.8833 |
| roomsDbl | 9 | 8 | %88.9 | 0.4089 |
| roomsSgl | 9 | 8 | %88.9 | 0.6133 |
| startDate | 9 | 9 | %100.0 | 0.95 |

| Alan grubu | n | Doğruluk |
|---|---|---|
| code | 32 | %90.6 |
| date | 22 | %95.5 |
| identity | 9 | %77.8 |
| money | 9 | %77.8 |
| quantity | 27 | %92.6 |

**Kalibrasyon** (güven aralığı → gözlenen doğruluk)

| Güven | n | Ort. güven | Doğruluk | Fark |
|---|---|---|---|---|
| 0.00–0.50 | 14 | 0 | %64.3 | -0.6429 |
| 0.50–0.60 | 0 | — | — | — |
| 0.60–0.70 | 6 | 0.65 | %66.7 | -0.0167 |
| 0.70–0.80 | 5 | 0.75 | %100.0 | -0.25 |
| 0.80–0.85 | 5 | 0.81 | %80.0 | 0.01 |
| 0.85–0.90 | 7 | 0.8671 | %100.0 | -0.1329 |
| 0.90–0.95 | 28 | 0.9136 | %92.9 | -0.015 |
| 0.95–1.00 | 34 | 0.95 | %100.0 | -0.05 |

## offer — 7 belge, 130 alan, doğruluk %88.5, ECE 0.1027, satır F1 1

| Alan | n | Doğru | Doğruluk | Ort. güven |
|---|---|---|---|---|
| currency | 7 | 7 | %100.0 | 0.95 |
| guaranteePax | 1 | 1 | %100.0 | 0.8 |
| lines[].board | 8 | 8 | %100.0 | 0.8125 |
| lines[].kind | 21 | 21 | %100.0 | 0.8376 |
| lines[].nights | 9 | 7 | %77.8 | 0.8111 |
| lines[].quantity | 21 | 18 | %85.7 | 0.8386 |
| lines[].roomType | 8 | 6 | %75.0 | 0.67 |
| lines[].unitPrice | 22 | 22 | %100.0 | 0.8405 |
| lines[].vatIncluded | 17 | 17 | %100.0 | 0.9 |
| optionUntil | 6 | 4 | %66.7 | 0.5667 |
| prepaymentRate | 4 | 2 | %50.0 | 0.45 |
| supplierName | 6 | 2 | %33.3 | 0.4583 |

| Alan grubu | n | Doğruluk |
|---|---|---|
| code | 7 | %100.0 |
| date | 6 | %66.7 |
| identity | 6 | %33.3 |
| lines | 106 | %93.4 |
| money | 4 | %50.0 |
| quantity | 1 | %100.0 |

**Kalibrasyon** (güven aralığı → gözlenen doğruluk)

| Güven | n | Ort. güven | Doğruluk | Fark |
|---|---|---|---|---|
| 0.00–0.50 | 8 | 0 | %0.0 | 0 |
| 0.50–0.60 | 13 | 0.57 | %69.2 | -0.1223 |
| 0.60–0.70 | 3 | 0.65 | %33.3 | 0.3167 |
| 0.70–0.80 | 0 | — | — | — |
| 0.80–0.85 | 9 | 0.8 | %100.0 | -0.2 |
| 0.85–0.90 | 27 | 0.8756 | %100.0 | -0.1244 |
| 0.90–0.95 | 63 | 0.9 | %98.4 | -0.0841 |
| 0.95–1.00 | 7 | 0.95 | %100.0 | -0.05 |

## contract — 4 belge, 57 alan, doğruluk %100.0, ECE 0.1481, satır F1 1

| Alan | n | Doğru | Doğruluk | Ort. güven |
|---|---|---|---|---|
| currency | 4 | 4 | %100.0 | 0.85 |
| customerName | 4 | 4 | %100.0 | 0.85 |
| endDate | 3 | 3 | %100.0 | 0.88 |
| guaranteePax | 4 | 4 | %100.0 | 0.66 |
| pax | 4 | 4 | %100.0 | 0.85 |
| prepaymentRate | 3 | 3 | %100.0 | 0.88 |
| rooms[].count | 5 | 5 | %100.0 | 0.88 |
| rooms[].nights | 5 | 5 | %100.0 | 0.88 |
| rooms[].type | 5 | 5 | %100.0 | 0.88 |
| rooms[].unitPrice | 5 | 5 | %100.0 | 0.88 |
| startDate | 4 | 4 | %100.0 | 0.85 |
| supplierName | 4 | 4 | %100.0 | 0.85 |
| totalAmount | 4 | 4 | %100.0 | 0.85 |
| vatSeparated | 3 | 3 | %100.0 | 0.88 |

| Alan grubu | n | Doğruluk |
|---|---|---|
| code | 7 | %100.0 |
| date | 7 | %100.0 |
| identity | 8 | %100.0 |
| lines | 20 | %100.0 |
| money | 7 | %100.0 |
| quantity | 8 | %100.0 |

**Kalibrasyon** (güven aralığı → gözlenen doğruluk)

| Güven | n | Ort. güven | Doğruluk | Fark |
|---|---|---|---|---|
| 0.00–0.50 | 1 | 0 | %100.0 | -1 |
| 0.50–0.60 | 0 | — | — | — |
| 0.60–0.70 | 0 | — | — | — |
| 0.70–0.80 | 6 | 0.76 | %100.0 | -0.24 |
| 0.80–0.85 | 0 | — | — | — |
| 0.85–0.90 | 50 | 0.88 | %100.0 | -0.12 |
| 0.90–0.95 | 0 | — | — | — |
| 0.95–1.00 | 0 | — | — | — |

## invoice — 5 belge, 40 alan, doğruluk %92.5, ECE 0.1825

| Alan | n | Doğru | Doğruluk | Ort. güven |
|---|---|---|---|---|
| currency | 5 | 5 | %100.0 | 0.9 |
| dueDate | 5 | 5 | %100.0 | 0.68 |
| invoiceNo | 5 | 5 | %100.0 | 0.9 |
| issueDate | 5 | 5 | %100.0 | 0.85 |
| netAmount | 5 | 4 | %80.0 | 0.9 |
| supplierName | 5 | 5 | %100.0 | 0.75 |
| totalAmount | 5 | 4 | %80.0 | 0.9 |
| vatAmount | 5 | 4 | %80.0 | 0.9 |

| Alan grubu | n | Doğruluk |
|---|---|---|
| code | 5 | %100.0 |
| date | 10 | %100.0 |
| identity | 10 | %100.0 |
| money | 15 | %80.0 |

**Kalibrasyon** (güven aralığı → gözlenen doğruluk)

| Güven | n | Ort. güven | Doğruluk | Fark |
|---|---|---|---|---|
| 0.00–0.50 | 1 | 0 | %100.0 | -1 |
| 0.50–0.60 | 0 | — | — | — |
| 0.60–0.70 | 2 | 0.6 | %100.0 | -0.4 |
| 0.70–0.80 | 3 | 0.7 | %0.0 | 0.7 |
| 0.80–0.85 | 0 | — | — | — |
| 0.85–0.90 | 12 | 0.85 | %100.0 | -0.15 |
| 0.90–0.95 | 10 | 0.9 | %100.0 | -0.1 |
| 0.95–1.00 | 12 | 0.95 | %100.0 | -0.05 |

## Dil bazında

| Dil | n | Doğruluk |
|---|---|---|
| en | 91 | %94.5 |
| ru | 50 | %64.0 |
| tr | 185 | %97.3 |

## Hatalar (28)

| Belge | Alan | Altın | Tahmin | Güven | Tür |
|---|---|---|---|---|---|
| inv-ru-01 | netAmount | 5680 | -1000 | 0.7 | mismatch |
| inv-ru-01 | totalAmount | 6248 | 248 | 0.7 | mismatch |
| inv-ru-01 | vatAmount | 568 | 1248 | 0.7 | mismatch |
| off-en-01 | prepaymentRate | 0.25 | — | 0 | missing |
| off-en-01 | supplierName | Bosphorus Palace Hotel | Bosphorus Palace Hotel – Group Quotation | 0.65 | mismatch |
| off-en-02 | optionUntil | 2027-02-15 | — | 0 | missing |
| off-en-02 | supplierName | Prime AV Solutions | — | 0 | missing |
| off-ru-01 | lines[0].nights | 2 | 1 | 0.57 | mismatch |
| off-ru-01 | lines[0].quantity | 12 | 1 | 0.57 | mismatch |
| off-ru-01 | lines[0].roomType | DBL | — | 0 | missing |
| off-ru-01 | lines[1].nights | 2 | 1 | 0.57 | mismatch |
| off-ru-01 | lines[1].quantity | 8 | 1 | 0.57 | mismatch |
| off-ru-01 | lines[1].roomType | SGL | — | 0 | missing |
| off-ru-01 | optionUntil | 2027-02-01 | — | 0 | missing |
| off-ru-01 | prepaymentRate | 0.5 | — | 0 | missing |
| off-ru-01 | supplierName | Отель Галата Резиденс | — | 0 | missing |
| off-tr-03 | lines[2].quantity | 2 | 200 | 0.9 | mismatch |
| off-tr-03 | supplierName | Moda Sahil Otel | Moda Sahil Otel — Grup Teklifi | 0.65 | mismatch |
| req-en-03 | language | en | tr | 0.82 | mismatch |
| req-ru-01 | budget | 30000 | 0 | 0.9 | mismatch |
| req-ru-01 | city | İstanbul | — | 0 | missing |
| req-ru-01 | customerName | ООО Северсталь Трейд | Бюджет 30 000 EUR. Компания ООО | 0.65 | mismatch |
| req-ru-02 | budget | 120000 | 0 | 0.9 | mismatch |
| req-ru-02 | city | Antalya | — | 0 | missing |
| req-ru-02 | customerName | АО Ромашка | Компания АО | 0.65 | mismatch |
| req-tr-03 | roomsDbl | 10 | — | 0 | missing |
| req-tr-03 | roomsSgl | 20 | — | 0 | missing |
| req-tr-04 | endDate | 2027-06-05 | — | 0 | missing |
