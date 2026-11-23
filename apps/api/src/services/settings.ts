// v0.5 S-19 (ana çatı 7): agency base currency. The admin requests a change; it takes effect only after a Face ID decision
// ('base_currency_change', admin-only, biometric, never automatic — AI forbidden list) and applies to NEW projects only: every
// project keeps the base currency it was created with (DB trigger project_base_currency). The change is audited (tenants audit row
// + the decision record with its reason).
import type { Currency, TenantSettings } from '@mice/shared';
import { isBaseCurrency } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import type { Row } from '../lib/mappers.js';
import { createDecision, expireDecisionsFor } from './decisions.js';
import { agencyBase, currentFx } from './fx.js';

export async function getSettings(ctx: Ctx): Promise<TenantSettings> {
  requireUser(ctx);
  const base = (await agencyBase(ctx.db)) as Currency;
  const pending = (await ctx.db.query(
    `SELECT id, detail FROM decisions WHERE kind = 'base_currency_change' AND status = 'open' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const fx = await currentFx(ctx.db);
  return {
    baseCurrency: base,
    pendingBaseCurrency: pending ? { currency: pending.detail?.currency, decisionId: pending.id } : null,
    fx: { source: fx.source, date: fx.date },
  };
}

export async function requestBaseCurrencyChange(ctx: Ctx, input: { currency: string; reason: string }): Promise<{ decisionId: string }> {
  const u = requireUser(ctx);
  if (u.role !== 'admin' || ctx.actor.type !== 'user') throw forbidden('Ana para birimini yalnız yönetici değiştirir', 'FORBIDDEN');
  const cur = input.currency?.toUpperCase();
  if (!isBaseCurrency(cur)) throw badRequest('Ana para birimi TRY, EUR veya USD olabilir', undefined, 'INVALID_CURRENCY');
  if (!input.reason?.trim()) throw badRequest('Gerekçe zorunlu', undefined, 'REASON_REQUIRED');
  const current = await agencyBase(ctx.db);
  if (cur === current) throw conflict(`Ana para birimi zaten ${cur}`, 'SAME_CURRENCY');
  // the new base needs a rate to compute with (never a silent fallback)
  const fx = await currentFx(ctx.db);
  if (cur !== 'EUR' && !fx.rates[cur]) throw conflict(`${cur} için kur kaydı yok — önce kur girin`, 'FX_RATE_MISSING');
  // a newer request replaces an open one
  await expireDecisionsFor(ctx, 'tenant', ctx.tenantId, ['base_currency_change']);
  const d = await createDecision(ctx, {
    kind: 'base_currency_change', badge: 'critical',
    summary: `Ana para birimi ${current} → ${cur} (yalnız yeni projeler)`,
    detail: { currency: cur, from: current, reason: input.reason.trim(), requestedBy: u.fullName },
    aiNote: 'Mevcut projeler oluşturuldukları para biriminde kalır; raporlar yeni ana para birimine çevrilerek gösterilir.',
    requiredRole: 'admin', requiresBiometric: true, entityType: 'tenant', entityId: ctx.tenantId, primaryActionLabel: 'Face ID ile onayla',
  });
  return { decisionId: d.id };
}

/** Decision effect: approve → tenants.base_currency (audited by the tenants audit trigger). Human + Face ID only. */
export async function baseCurrencyChangeEffect(ctx: Ctx, d: Row, input: { action: string; decidedBy: string | null; auto?: boolean }): Promise<string[]> {
  if (input.action === 'reject') return ['base_currency_unchanged'];
  if (input.auto || !input.decidedBy || ctx.actor.type !== 'user') throw forbidden('Ana para birimi değişikliği yapay zekâ tarafından yapılamaz', 'AI_FORBIDDEN_ACTION');
  const cur = String(d.detail?.currency ?? '');
  if (!isBaseCurrency(cur)) return ['invalid_currency'];
  await ctx.db.query('UPDATE tenants SET base_currency = $1, updated_at = now() WHERE id = app_tenant_id()', [cur]);
  return [`base_currency:${cur}`];
}
