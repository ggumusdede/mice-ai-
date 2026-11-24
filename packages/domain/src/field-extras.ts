// §17.1 / §17.7 Saha ekstra harcamaları: kalem başı 5.000 TL, proje toplamı 15.000 TL
/** true when the field lead may NOT decide alone: item above the per-item limit, or the project total (including this item)
 *  above the per-project limit. Limits are inclusive (exactly 5.000 / 15.000 TL is still within the field lead's authority). */
export function fieldExtraNeedsAdmin(amountTry: number, projectExtrasSoFarTry: number, limits: { perItem: number; perProject: number }): boolean {
  if (!Number.isFinite(amountTry)) return true;
  const amount = Math.max(0, amountTry);
  const soFar = Math.max(0, Number.isFinite(projectExtrasSoFarTry) ? projectExtrasSoFarTry : 0);
  const eps = 1e-9;
  return amount > limits.perItem + eps || soFar + amount > limits.perProject + eps;
}
