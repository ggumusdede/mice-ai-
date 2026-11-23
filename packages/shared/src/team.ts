// v0.5-A "Ekip, iletişim ve kontrol" (docs/12-v05-kararlar.md S-01, S-02, S-08…S-15, S-25, S-26, D-2, D-3; docs/11 K-01,
// K-04…K-06, K-24, K-27…K-29). Additive HTTP contract + shared constants. Every route is under /api, Bearer JWT, lists {items}.
import type { ID, ISODate, ISODateTime } from './models.js';
import type { TeamPerformanceRow } from './api.js';
import type { Role } from './enums.js';

// ------------------------------------------------------------------ S-01 hızlı onay: hazır mesaj şablonları
/** Who a quick message goes to. 'participant' is allowed only when the project's participant messaging is not 'off' (S-02). */
export type QuickRecipient = 'customer' | 'supplier' | 'participant' | 'field_contact';
export type QuickTemplateKey = 'request_received' | 'delay_notice' | 'crisis_notice' | 'collection_reminder' | 'option_release_notice';

export interface QuickTemplate {
  key: QuickTemplateKey;
  /** plain Turkish label shown on the button */
  label: string;
  /** one-line hint (no jargon) */
  hint: string;
  recipient: QuickRecipient;
  channel: 'email' | 'whatsapp' | 'sms';
  subject: string;
  /** {{projectCode}} {{customerName}} {{senderName}} {{agencyName}} {{time}} {{note}} {{amount}} {{dueDate}} */
  body: string;
  /** variables the user may type (all others are filled from data) */
  inputs: { key: string; label: string; required?: boolean }[];
  /** logistics message (allowed to participants when the project setting is 'logistics') */
  logistics: boolean;
}

export const QUICK_TEMPLATES: readonly QuickTemplate[] = [
  {
    key: 'request_received', label: 'Talebiniz alındı', hint: 'Yeni talebe kısa teyit — ne zaman döneceğinizi yazın.', recipient: 'customer', channel: 'email',
    subject: '{{projectCode}} — talebiniz alındı',
    body: 'Merhaba,\n\nTalebinizi aldık ({{projectCode}}). {{note}}\n\nSaygılarımızla,\n{{senderName}}\n{{agencyName}}',
    inputs: [{ key: 'note', label: 'Ne zaman dönüş yapacaksınız?', required: true }], logistics: false,
  },
  {
    key: 'delay_notice', label: 'Gecikme / rötar bildirimi', hint: 'Uçak rötarı veya program kayması — yeni saati yazın.', recipient: 'customer', channel: 'whatsapp',
    subject: '{{projectCode}} — saat değişikliği',
    body: 'Bilgilendirme ({{projectCode}}): {{note}} Yeni saat: {{time}}.\n{{senderName}} — {{agencyName}}',
    inputs: [{ key: 'note', label: 'Ne oldu?', required: true }, { key: 'time', label: 'Yeni saat', required: true }], logistics: true,
  },
  {
    key: 'crisis_notice', label: 'Kriz bilgilendirmesi', hint: 'Deprem, grev, uçuş iptali — önceden onaylı kısa metin.', recipient: 'customer', channel: 'whatsapp',
    subject: '{{projectCode}} — önemli bilgilendirme',
    body: 'Önemli bilgilendirme ({{projectCode}}): {{note}} Ekibimiz sahada ve durumu takip ediyor. Acil hat: {{phone}}.\n{{senderName}} — {{agencyName}}',
    inputs: [{ key: 'note', label: 'Kısa durum', required: true }, { key: 'phone', label: 'Acil telefon', required: true }], logistics: true,
  },
  {
    key: 'collection_reminder', label: 'Ödeme hatırlatması', hint: 'Vadesi geçen tutar için nazik hatırlatma.', recipient: 'customer', channel: 'email',
    subject: '{{projectCode}} — ödeme hatırlatması',
    body: 'Merhaba,\n\n{{projectCode}} için {{dueDate}} vadeli {{amount}} tutarındaki ödemeyi hatırlatmak isteriz. Ödeme yapıldıysa bu mesajı dikkate almayınız.\n\nSaygılarımızla,\n{{senderName}}\n{{agencyName}}',
    inputs: [], logistics: false,
  },
  {
    key: 'option_release_notice', label: 'Opsiyon bırakma bildirimi', hint: 'Tedarikçiye opsiyonu bıraktığınızı bildirin.', recipient: 'supplier', channel: 'email',
    subject: '{{projectCode}} — opsiyon bırakma',
    body: 'Merhaba,\n\n{{projectCode}} referanslı opsiyonu bırakıyoruz. {{note}}\n\nTeşekkürler,\n{{senderName}}\n{{agencyName}}',
    inputs: [{ key: 'note', label: 'Kısa not (isteğe bağlı)' }], logistics: false,
  },
];

// ------------------------------------------------------------------ S-01 toplu / tek dokunuş onay
/** Decision kinds that may be approved with one tap / in a batch (outbound messages without a biometric gate). */
export const QUICK_APPROVAL_KINDS = ['outbound_message', 'rfq_send', 'negotiation_message'] as const;

export interface QuickApprovalCard {
  decisionId: ID;
  kind: string;
  projectId: ID | null;
  projectCode: string | null;
  summary: string;
  channel: 'email' | 'whatsapp' | 'sms' | null;
  to: string | null;
  subject: string | null;
  /** first ~240 characters of the message */
  preview: string;
  urgent: boolean;
  assignedToName: string | null;
  escalationLevel: number;
  createdAt: ISODateTime;
}
// GET  /api/quick-approvals                 -> List<QuickApprovalCard>   (only cards the caller may decide)
// POST /api/decisions/batch-approve  body BatchApproveRequest -> BatchApproveResponse  (each card = its own decision + audit)
// GET  /api/quick-templates                 -> List<QuickTemplate>       (agency text applied)
// POST /api/projects/:id/quick-messages body QuickMessageRequest -> Decision (draft + one-tap card; nothing is sent yet)
export interface BatchApproveRequest { ids: ID[]; device?: string }
export interface BatchApproveResponse { results: { id: ID; ok: boolean; effects?: string[]; error?: string; code?: string }[]; approved: number }
export interface QuickMessageRequest {
  template: QuickTemplateKey;
  /** recipient address / phone; default: first customer contact (customer) */
  to?: string;
  channel?: 'email' | 'whatsapp' | 'sms';
  recipient?: QuickRecipient;
  vars?: Record<string, string>;
}

// ------------------------------------------------------------------ nöbet (on-call), vekil, ekip
export interface OnCallShift { id: ID; userId: ID; userName: string; startsAt: ISODateTime; endsAt: ISODateTime; note: string | null; status: 'active' | 'cancelled' }
// GET  /api/on-call?from&to  -> List<OnCallShift> ; GET /api/on-call/now -> { shift: OnCallShift | null }
// POST /api/on-call body {userId, startsAt, endsAt, note?} (admin) ; POST /api/on-call/:id/cancel (admin)

export interface TeamMember { userId: ID; fullName: string; role: Role; active: boolean }
export interface Team { id: ID; name: string; leaderId: ID | null; leaderName: string | null; active: boolean; members: TeamMember[] }
// GET /api/teams -> List<Team> ; POST /api/teams body TeamInput (admin) ; PATCH /api/teams/:id body Partial<TeamInput> & {active?} (admin)
export interface TeamInput { name: string; leaderId?: ID | null; memberIds?: ID[] }

/** Per-user settings the admin manages (team, busy-deputy, personal-account exception, quiet hours). */
export interface UserTeamSettings {
  userId: ID; fullName: string; email: string; role: Role; active: boolean;
  teamId: ID | null; deputyUserId: ID | null; personalAccountAllowed: boolean;
  /** null = follows the agency setting */
  quietHours: { enabled: boolean; start: string; end: string } | null;
}
// GET /api/team-settings/users -> List<UserTeamSettings> (admin)
// PATCH /api/team-settings/users/:id body Partial<Pick<UserTeamSettings,'teamId'|'deputyUserId'|'personalAccountAllowed'|'quietHours'>> (admin)
// GET/PATCH /api/me/preferences  { quietHours: … | null }  (own quiet hours, S-14)

// ------------------------------------------------------------------ S-10 / S-11 / S-12 performans
export interface MyPerformance {
  from: ISODate; to: ISODate;
  /** own figures only — no names, no ranking (S-10) */
  row: Omit<TeamPerformanceRow, 'fullName' | 'role' | 'authorityLevel' | 'active'> | null;
  /** S-11: only when the agency enabled showEstimatedBonus */
  estimatedBonus: { amount: number; currency: string; basis: 'realized_profit' | 'planned_profit'; rate: number; onlyCollected: boolean; explanation: string } | null;
  teamName: string | null;
  note: string;
}
export interface TeamPerformanceTeamRow {
  teamId: ID; name: string; leaderName: string | null; memberCount: number;
  requests: number; quotesSent: number; won: number; lost: number; winRate: number | null;
  quotesBuilt: number; quotesReviewed: number; quotesCorrected: number; correctionRate: number | null;
  approvalRequiredQuotes: number; freeQuotes: number; blockedQuotes: number;
  plannedProfitEur: number | null; realizedProfitEur: number | null;
}
export interface PromiseKeepingScore {
  /** 0..100, null = not enough data */
  score: number | null;
  paymentsDue: number; paymentsOnTime: number; optionsDue: number; optionsHandled: number;
}
export interface PromiseKeepingReport {
  agency: PromiseKeepingScore;
  projects: (PromiseKeepingScore & { projectId: ID; code: string; title: string })[];
  note: string;
}
// GET /api/me/performance?from&to -> MyPerformance
// GET /api/reports/team-performance (admin) now also returns `teams: TeamPerformanceTeamRow[]`
// GET /api/reports/my-team-performance (team leader) -> TeamPerformanceReport filtered to the leader's team (alphabetical, no rank)
// GET /api/reports/promise-keeping -> PromiseKeepingReport (agency + project level; never per person, S-12)

// ------------------------------------------------------------------ S-08 müşteri adı gizleme istisnası, K-04 ilişki sahibi
export interface CustomerDisclosure {
  id: ID; customerId: ID; supplierId: ID; supplierName: string; reason: string;
  grantedBy: ID; grantedByName: string | null; grantedAt: ISODateTime; revokedAt: ISODateTime | null; revokedByName: string | null; active: boolean;
}
// GET /api/customers/:id/disclosures -> List<CustomerDisclosure> ; POST body {supplierId, reason} (admin) ; POST /api/disclosures/:id/revoke {reason} (admin)
export interface CustomerRelationship {
  customerId: ID; customerName: string; ownerId: ID | null; ownerName: string | null; backupId: ID | null; backupName: string | null; missingBackup: boolean;
}
// GET /api/customer-relationships -> List<CustomerRelationship> ; PATCH /api/customers/:id/relationship {ownerId?, backupId?} (admin)

// ------------------------------------------------------------------ S-02 katılımcı mesajı, S-09 projeye ilet
export type ParticipantMessaging = 'off' | 'logistics' | 'on';
// GET /api/projects/:id/participant-messaging -> { mode, source: 'project'|'agency' } ; PATCH {mode, reason} (admin / ops)
export interface ForwardToProjectRequest { text: string; source: 'whatsapp' | 'email' | 'other'; from?: string }
// POST /api/projects/:id/forward body ForwardToProjectRequest -> { id } (stored as an inbound message "kişisel kanal, çalışan iletti")

// ------------------------------------------------------------------ K-05 devir-teslim
export type HandoverMode = 'planned' | 'urgent';
export interface HandoverPackage {
  generatedAt: ISODateTime;
  projects: { id: ID; code: string; title: string; customerName: string | null; step: number; outcome: string; startDate: ISODate | null }[];
  customers: { id: ID; name: string; role: 'owner' | 'backup'; backupName: string | null }[];
  pendingDecisions: { id: ID; summary: string; kind: string; projectCode: string | null }[];
  deadlines: { kind: string; title: string; dueAt: ISODateTime | ISODate; projectCode: string | null }[];
  openTasks: number;
}
export interface Handover {
  id: ID; fromUserId: ID; fromName: string; toUserId: ID; toName: string; mode: HandoverMode; reason: string;
  effectiveAt: ISODateTime; status: 'scheduled' | 'access_closed' | 'completed' | 'cancelled';
  accessClosedAt: ISODateTime | null; completedAt: ISODateTime | null; createdAt: ISODateTime;
  package: HandoverPackage;
  /** projects the recipient marked "okudum" */
  readProjectIds: ID[];
  readPct: number;
}
// POST /api/handovers body HandoverInput (admin; urgent → Face ID + reason) -> Handover
// GET  /api/handovers -> List<Handover> (admin: all; others: those handed to them)
// GET  /api/handovers/:id ; POST /api/handovers/:id/read {projectId} (recipient) ; POST /api/handovers/:id/refresh (admin) ;
// POST /api/handovers/:id/cancel (admin, before access is closed)
export interface HandoverInput {
  fromUserId: ID; toUserId: ID; mode: HandoverMode; reason: string;
  /** planned only: when access closes (default now + 0) */
  effectiveAt?: ISODateTime;
  biometric?: { method: 'webauthn' | 'dev'; [k: string]: unknown };
}

// ------------------------------------------------------------------ S-15 çevrimdışı saha paketi
export interface FieldPackGuest { name: string; room: string | null; group: string | null; phone: string | null }
export interface FieldPackProject { id: ID; code: string; title: string; venue: string | null; startDate: ISODate | null; endDate: ISODate | null; guests: FieldPackGuest[] }
export interface FieldPackData { packId: ID; date: ISODate; issuedAt: ISODateTime; expiresAt: ISODateTime; userName: string; projects: FieldPackProject[] }
/** The pack is returned once together with a fresh AES-256 key (base64). The server keeps only a hash of the key; the device
 *  encrypts the pack with it (WebCrypto AES-GCM) and keeps the key non-extractable. Approvals are never part of the pack. */
export interface FieldPackResponse { pack: FieldPackData; key: string }
export interface FieldPackStatus { packId: ID; valid: boolean; revokedAt: ISODateTime | null; expiresAt: ISODateTime; reason: 'ok' | 'revoked' | 'expired' }
export interface FieldPackSummary { id: ID; userId: ID; userName: string; date: ISODate; issuedAt: ISODateTime; expiresAt: ISODateTime; revokedAt: ISODateTime | null; guestCount: number }
// POST /api/field/packs {date?} -> FieldPackResponse ; GET /api/field/packs/:id/status -> FieldPackStatus
// GET  /api/field/packs -> List<FieldPackSummary> (admin: all recent; others: own) ; POST /api/field/packs/:id/revoke (admin)
// PUT  /api/projects/:id/field-staff {userId, transferGroup?} (admin / ops) ; GET -> List<{userId, userName, transferGroup}>
// PATCH /api/guests/:id/field-info {roomNo?, transferGroup?} (admin / ops)
