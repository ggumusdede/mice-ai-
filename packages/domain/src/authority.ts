// §4 + §17.1 Kişi bazlı yetki ve vekâlet
import type { DecisionKind, Delegation, Role, User } from '@mice/shared';

/** Decision kinds that ONLY the admin can decide (never a delegate): accreditation, rule/threshold/authority changes, automation promotion, rule suggestions, checklist questions.
 *  margin_override: ürün sahibi kararı (v0.4 S-G03) — vekil hedef marj altı teklifi hazırlayıp açabilir, ama açma kararı yalnız
 *  acenta yöneticisinin (admin) onayına sunulur.
 *  low_supplier_score is an accreditation decision too (§7 Adım 8 "akreditasyon kararı yöneticide": its Düzelt passivates the supplier). */
export const ADMIN_ONLY_DECISIONS: DecisionKind[] = ['supplier_accreditation', 'automation_promotion', 'rule_suggestion', 'checklist_question', 'low_supplier_score', 'margin_override', 'base_currency_change'];

/** (additive) Active delegation for `userId` at `now` (startsAt <= now <= endsAt), if any. */
export function activeDelegation(userId: string, delegations: Delegation[], now: Date): Delegation | null {
  const t = now.getTime();
  return (
    delegations.find((d) => {
      if (d.delegateId !== userId) return false;
      const s = Date.parse(d.startsAt);
      const e = Date.parse(d.endsAt);
      return !Number.isNaN(s) && !Number.isNaN(e) && s <= t && t <= e;
    }) ?? null
  );
}

/** Decisions a delegate may take while delegation is active: payments and contracts (and everything not admin-only). */
export function canDecide(user: Pick<User, 'id' | 'role'>, decision: { kind: DecisionKind; requiredRole: Role }, delegations: Delegation[], now: Date): { allowed: boolean; viaDelegation: boolean; reason?: string } {
  if (user.role === 'admin') return { allowed: true, viaDelegation: false };
  const adminOnly = ADMIN_ONLY_DECISIONS.includes(decision.kind);
  if (adminOnly) return { allowed: false, viaDelegation: false, reason: 'Bu karar yalnızca yöneticiye aittir (akreditasyon, kural / otomasyon değişikliği vekile devredilemez).' };
  if (decision.requiredRole !== 'admin' && decision.requiredRole === user.role) return { allowed: true, viaDelegation: false };
  if (activeDelegation(user.id, delegations, now)) return { allowed: true, viaDelegation: true };
  const hadDelegation = delegations.some((d) => d.delegateId === user.id);
  return {
    allowed: false,
    viaDelegation: false,
    reason: hadDelegation ? 'Vekâlet bu tarih için geçerli değil.' : `Bu karar için gereken rol: ${decision.requiredRole}.`,
  };
}

/** §15 "Para ve sözleşme onaylarında biyometrik doğrulama zorunlu": payments, contracts, field extras (money spent on site) and
 *  customer quotes — a sent quote is a priced commitment to the customer, so its approval and a below-target margin override are
 *  money approvals too. */
const BIOMETRIC: ReadonlySet<DecisionKind> = new Set<DecisionKind>(['payment_approval', 'contract_approval', 'field_extra', 'quote_approval', 'margin_override', 'base_currency_change']);
/** Money and contract approvals require biometric (Face ID) step-up (§15). */
export function requiresBiometric(kind: DecisionKind): boolean {
  return BIOMETRIC.has(kind);
}

type Capability = 'send_quote' | 'create_candidate_supplier' | 'accredit_supplier' | 'approve_payment' | 'create_payment_request' | 'sign_contract' | 'confirm_supplier' | 'change_rules' | 'match_invoices' | 'field_extra' | 'view_guest_pii';
const ROLE_CAPS: Record<Role, ReadonlySet<Capability>> = {
  admin: new Set<Capability>(['send_quote', 'create_candidate_supplier', 'accredit_supplier', 'approve_payment', 'create_payment_request', 'sign_contract', 'confirm_supplier', 'change_rules', 'match_invoices', 'field_extra', 'view_guest_pii']),
  clerk_sales: new Set<Capability>(['send_quote', 'create_candidate_supplier']),
  clerk_ops: new Set<Capability>(['create_candidate_supplier', 'view_guest_pii']),
  field: new Set<Capability>(['field_extra', 'view_guest_pii']),
  finance: new Set<Capability>(['create_payment_request', 'match_invoices']),
  signatory: new Set<Capability>(['sign_contract']),
};
/** Role capabilities (§17.1): clerk cannot confirm/contract/pay/accredit; finance creates payment requests but cannot approve. */
export function roleCan(role: Role, capability: Capability): boolean {
  return ROLE_CAPS[role]?.has(capability) ?? false;
}
