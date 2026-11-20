// §7 Adım 1 Kısa liste: önce talep edilen semt, sonra şehir; kapasite uyumu, geçmiş fiyat avantajı, yanıt hızı, performans
import type { Supplier, ServiceKind } from '@mice/shared';
import { notImplemented } from './_todo.js';
export interface ShortlistRequest { kind: ServiceKind; city: string | null; district: string | null; pax: number | null; rooms: number | null; avgHistoricalAdvantage?: Record<string, number> }
export function rankSuppliers(suppliers: Supplier[], req: ShortlistRequest): { supplier: Supplier; score: number; reasons: string[]; sameDistrict: boolean; candidate: boolean }[] { return notImplemented('rankSuppliers'); }
