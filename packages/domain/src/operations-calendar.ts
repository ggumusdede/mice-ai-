// §7 Adım 6 Sözleşme tarihlerinden otomatik takvim
import type { ContractFields } from '@mice/shared';
import { notImplemented } from './_todo.js';
export interface OpsTaskSpec { kind: 'final_pax' | 'attrition' | 'rooming_list' | 'menu_approval' | 'tech_brief' | 'transfer_list' | 'payment_due' | 'event_day_checklist'; title: string; dueDate: string; role: 'clerk_ops' | 'finance' | 'field' }
/** Derives the operations calendar from contract dates/terms + event start. Defaults when unspecified:
 *  final pax/attrition T-14, rooming list T-10, menu approval T-7, tech brief T-5, transfer list T-3, checklist T-1;
 *  payment due dates parsed from paymentTerms/prepaymentRate when possible (prepayment due at signing+7d). */
export function operationsCalendar(contract: ContractFields, eventStart: string, signedAt: string | null): OpsTaskSpec[] { return notImplemented('operationsCalendar'); }
