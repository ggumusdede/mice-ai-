// DB rows (snake_case) → API models (camelCase, exactly as packages/shared/src/models.ts).
import type {
  AuditEntry, AutomationCounter, ChecklistQuestion, Contract, Customer, Decision, Delegation, FinanceEntry,
  GeneratedDocument, InboundMessage, MessageDraft, Project, Quote, QuoteLine, Rfq, ServiceItem, Supplier, SupplierOffer,
  Task, User, AiActionType,
} from '@mice/shared';
import { iso } from './dates.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapUser(r: Row): User {
  return {
    id: r.id, tenantId: r.tenant_id, email: r.email, fullName: r.full_name, role: r.role,
    authorityLevel: r.authority_level, authorityScope: r.authority_scope ?? {}, canSign: r.can_sign,
    languages: r.languages ?? ['tr'], active: r.active,
  };
}

export function mapDelegation(r: Row): Delegation {
  return { id: r.id, tenantId: r.tenant_id, adminId: r.admin_id, delegateId: r.delegate_id, startsAt: iso(r.starts_at)!, endsAt: iso(r.ends_at)! };
}

export function mapSupplier(r: Row): Supplier {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, kinds: r.kinds ?? [], city: r.city, district: r.district,
    lat: num(r.lat), lng: num(r.lng), capacityPax: num(r.capacity_pax), roomCount: num(r.room_count), halls: r.halls ?? [],
    status: r.status, segment: r.segment, email: r.email, phone: r.phone, contactName: r.contact_name, commission: r.commission,
    paymentTerms: r.payment_terms, performanceScore: num(r.performance_score), avgResponseHours: num(r.avg_response_hours),
    accreditedBy: r.accredited_by, accreditedAt: iso(r.accredited_at), taxNumber: r.tax_number ?? null,
  };
}

export function mapCustomer(r: Row): Customer {
  return {
    id: r.id, tenantId: r.tenant_id, name: r.name, shortCode: r.short_code, taxOffice: r.tax_office, taxNumber: r.tax_number,
    billingAddress: r.billing_address, contacts: r.contacts ?? [],
    rules: {
      firmApproval: 'signed_or_po', depositRate: 0, omitPaymentCancellationClauses: false, specialClauses: [],
      preferredLanguage: 'tr', preferredCurrency: 'EUR', ...(r.rules ?? {}),
    },
  };
}

export function mapProject(r: Row): Project {
  return {
    id: r.id, tenantId: r.tenant_id, code: r.code, seq: r.seq, customerId: r.customer_id, customerName: r.customer_name,
    title: r.title, eventType: r.event_type, startDate: r.start_date, endDate: r.end_date, dateFlexibility: r.date_flexibility,
    pax: num(r.pax), roomsSgl: num(r.rooms_sgl), roomsDbl: num(r.rooms_dbl), city: r.city, district: r.district,
    hallLayout: r.hall_layout, fnbNeeds: r.fnb_needs, technicalNeeds: r.technical_needs, transferNeeds: r.transfer_needs,
    budget: num(r.budget), budgetCurrency: r.budget_currency, budgetSegment: r.budget_segment, decisionDate: r.decision_date,
    billingInfo: r.billing_info, extraction: r.extraction, step: r.step, outcome: r.outcome, lostReason: r.lost_reason,
    ownerId: r.owner_id, venueName: r.venue_name, receivedAt: iso(r.received_at)!, quoteSentAt: iso(r.quote_sent_at),
    targetBusinessDays: Number(r.target_business_days), targetOverrideReason: r.target_override_reason,
    customerWaitMinutes: r.customer_wait_minutes, eventEndedAt: iso(r.event_ended_at), closedAt: iso(r.closed_at),
    createdAt: iso(r.created_at)!, historical: r.historical === true,
  };
}

export function mapInbound(r: Row): InboundMessage {
  return { id: r.id, tenantId: r.tenant_id, projectId: r.project_id, channel: r.channel, fromAddress: r.from_address, subject: r.subject, body: r.body, receivedAt: iso(r.received_at)! };
}

export function mapServiceItem(r: Row): ServiceItem {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, kind: r.kind, description: r.description,
    dateFrom: r.date_from, dateTo: r.date_to, quantity: Number(r.quantity), unit: r.unit, nights: num(r.nights),
    specs: r.specs ?? {}, selectedOfferId: r.selected_offer_id, valueAdd: r.value_add, status: r.status,
  };
}

export function mapRfq(r: Row): Rfq {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, serviceItemId: r.service_item_id, supplierId: r.supplier_id,
    status: r.status, sentBy: r.sent_by, sentAt: iso(r.sent_at), deadlineAt: iso(r.deadline_at), linkExpiresAt: iso(r.link_expires_at),
    reminderSentAt: iso(r.reminder_sent_at), callTaskCreatedAt: iso(r.call_task_created_at), overrideReason: r.override_reason,
  };
}

export function mapOffer(r: Row): SupplierOffer {
  return {
    id: r.id, tenantId: r.tenant_id, rfqId: r.rfq_id, serviceItemId: r.service_item_id, supplierId: r.supplier_id,
    version: r.version, source: r.source, currency: r.currency, lines: r.lines ?? [], optionUntil: r.option_until,
    guaranteePax: num(r.guarantee_pax), attritionTerms: r.attrition_terms, paymentTerms: r.payment_terms,
    prepaymentRate: num(r.prepayment_rate), cancellationTerms: r.cancellation_terms, overtimeTerms: r.overtime_terms,
    notes: r.notes, confidence: num(r.confidence), verifiedBy: r.verified_by, supersededBy: r.superseded_by,
    negotiationRound: r.negotiation_round, createdAt: iso(r.created_at)!,
  };
}

export function mapQuoteLine(r: Row): QuoteLine {
  return {
    id: r.id, optionNo: r.option_no, serviceItemId: r.service_item_id, offerId: r.offer_id, description: r.description,
    kind: r.kind, quantity: Number(r.quantity), unit: r.unit, nights: num(r.nights), unitCostEur: Number(r.unit_cost_eur),
    unitPriceEur: Number(r.unit_price_eur), markup: Number(r.markup), vatRate: Number(r.vat_rate), valueAdd: r.value_add,
    supplierOptionUntil: r.supplier_option_until,
  };
}

/** options are assembled by services/quotes.ts (they need tax rules); this maps the scalar part. */
export function mapQuoteBase(r: Row): Omit<Quote, 'options'> {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, version: r.version, status: r.status, currency: r.currency,
    fxRate: Number(r.fx_rate), fxSource: r.fx_source, fxDate: r.fx_date, optionUntil: r.option_until,
    appliedCustomerRules: r.applied_customer_rules ?? [], blockReasons: r.block_reasons ?? [], requiresApproval: r.requires_approval,
    createdBy: r.created_by, approvedBy: r.approved_by, sentAt: iso(r.sent_at), openedAt: iso(r.opened_at),
    acceptedOptionNo: r.accepted_option_no, acceptedAt: iso(r.accepted_at), marginOverrideReason: r.margin_override_reason,
    createdAt: iso(r.created_at)!,
  };
}

export function mapContract(r: Row): Contract {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, supplierId: r.supplier_id, serviceItemIds: r.service_item_ids ?? [],
    version: r.version, template: r.template, status: r.status, fields: r.fields, extractionConfidence: num(r.extraction_confidence),
    diff: r.diff ?? [], conditionRiskEur: num(r.condition_risk_eur), conditionRiskNote: r.condition_risk_note, locked: r.locked,
    signedAt: iso(r.signed_at), signedBy: r.signed_by, amendmentOf: r.amendment_of, createdAt: iso(r.created_at)!,
  };
}

export function mapDocument(r: Row): GeneratedDocument {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, kind: r.kind, version: r.version, status: r.status,
    staleReason: r.stale_reason, generatedAt: iso(r.generated_at)!, content: r.content ?? {},
    downloadUrl: r.file_data !== undefined || r.has_file ? `/api/documents/${r.id}/file` : undefined,
  };
}

export function mapTask(r: Row): Task {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, assigneeId: r.assignee_id, kind: r.kind, title: r.title,
    dueAt: iso(r.due_at), status: r.status, source: r.source,
  };
}

export function mapDecision(r: Row): Decision {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, projectCode: r.project_code ?? null, kind: r.kind, badge: r.badge,
    summary: r.summary, detail: r.detail ?? {}, aiNote: r.ai_note, primaryActionLabel: r.primary_action_label,
    requiredRole: r.required_role, requiresBiometric: r.requires_biometric, urgent: r.urgent, entityType: r.entity_type,
    entityId: r.entity_id, draft: r.draft, status: r.status, decidedBy: r.decided_by, decidedAt: iso(r.decided_at),
    decidedDevice: r.decided_device, viaDelegation: r.via_delegation, createdAt: iso(r.created_at)!,
  };
}

export function mapDraft(r: Row): MessageDraft {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, kind: r.kind, channel: r.channel, to: r.to_address,
    subject: r.subject, body: r.body, language: r.language, status: r.status, fromUserId: r.from_user_id,
    aiGenerated: r.ai_generated, createdAt: iso(r.created_at)!,
  };
}

export function mapFinance(r: Row): FinanceEntry {
  return {
    id: r.id, tenantId: r.tenant_id, projectId: r.project_id, serviceItemId: r.service_item_id, supplierId: r.supplier_id,
    kind: r.kind, amount: Number(r.amount), currency: r.currency, amountEur: Number(r.amount_eur), dueDate: r.due_date,
    status: r.status, reference: r.reference, invoiceNo: r.invoice_no, meta: r.meta ?? {}, createdAt: iso(r.created_at)!,
    fxEvidence: {
      actualFxRate: num(r.actual_fx_rate), eurTryRate: num(r.eur_try_rate), rateSource: r.rate_source ?? null, valueDate: r.value_date ?? null,
      paid: r.paid_at || r.paid_amount != null
        ? { amount: num(r.paid_amount), currency: r.paid_currency ?? null, fxRate: num(r.paid_fx_rate), eurTryRate: num(r.paid_eur_try_rate), rateSource: r.paid_rate_source ?? null }
        : null,
    },
  };
}
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapChecklist(r: Row): ChecklistQuestion {
  return { id: r.id, tenantId: r.tenant_id, eventType: r.event_type, question: r.question, field: r.field, status: r.status, source: r.source };
}

export function mapCounter(r: Row): AutomationCounter {
  return {
    actionType: r.action_type as AiActionType, mode: r.mode, consecutiveClean: r.consecutive_clean, threshold: r.threshold,
    sampleRate: Number(r.sample_rate), promotedAt: iso(r.promoted_at), demotedAt: iso(r.demoted_at), totalAuto: r.total_auto,
    totalSampled: r.total_sampled, sampleErrors: r.sample_errors,
  };
}

export function mapAudit(r: Row): AuditEntry {
  return {
    id: String(r.id), tenantId: r.tenant_id, actorType: r.actor_type, actorId: r.actor_id, entity: r.entity, entityId: r.entity_id,
    action: r.action, before: r.before, after: r.after, device: r.device, at: iso(r.at)!,
  };
}
