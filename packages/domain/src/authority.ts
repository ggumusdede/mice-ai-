// §4 + §17.1 Kişi bazlı yetki ve vekâlet
import type { DecisionKind, Delegation, Role, User } from '@mice/shared';
import { notImplemented } from './_todo.js';
/** Decision kinds that ONLY the admin can decide (never a delegate): accreditation, rule/threshold/authority changes, automation promotion, rule suggestions, checklist questions. */
export const ADMIN_ONLY_DECISIONS: DecisionKind[] = ['supplier_accreditation', 'automation_promotion', 'rule_suggestion', 'checklist_question'];
/** Decisions a delegate may take while delegation is active: payments and contracts (and everything not admin-only). */
export function canDecide(user: Pick<User, 'id' | 'role'>, decision: { kind: DecisionKind; requiredRole: Role }, delegations: Delegation[], now: Date): { allowed: boolean; viaDelegation: boolean; reason?: string } { return notImplemented('canDecide'); }
/** Money and contract approvals require biometric (Face ID) step-up (§15). */
export function requiresBiometric(kind: DecisionKind): boolean { return notImplemented('requiresBiometric'); }
/** Role capabilities (§17.1): clerk cannot confirm/contract/pay/accredit; finance creates payment requests but cannot approve. */
export function roleCan(role: Role, capability: 'send_quote' | 'create_candidate_supplier' | 'accredit_supplier' | 'approve_payment' | 'create_payment_request' | 'sign_contract' | 'confirm_supplier' | 'change_rules' | 'match_invoices' | 'field_extra' | 'view_guest_pii'): boolean { return notImplemented('roleCan'); }
