// §17.1 / §17.7 Saha ekstra: kalem başı 5.000 TL, proje toplamı 15.000 TL'ye kadar saha sorumlusu karar verir.
export interface ExtraLimits { perItem: number; perProject: number }

export interface ExtraLimitStatus {
  needsAdmin: boolean;
  overItem: boolean;
  overProject: boolean;
  projectTotalAfter: number;
  remainingProject: number;
}

/** Display-side pre-check; the server decides (FieldExtra.needsAdminApproval). */
export function extraLimitStatus(amountTry: number, projectSoFarTry: number, limits: ExtraLimits): ExtraLimitStatus {
  const amount = Number.isFinite(amountTry) && amountTry > 0 ? amountTry : 0;
  const after = projectSoFarTry + amount;
  const overItem = amount > limits.perItem;
  const overProject = after > limits.perProject;
  return {
    needsAdmin: overItem || overProject,
    overItem,
    overProject,
    projectTotalAfter: after,
    remainingProject: Math.max(0, limits.perProject - projectSoFarTry),
  };
}
