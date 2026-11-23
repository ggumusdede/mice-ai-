// v0.5-A "Ekip, iletişim ve kontrol" — typed client for the additive contract in @mice/shared (packages/shared/src/team.ts).
import type {
  BatchApproveResponse, CustomerDisclosure, CustomerRelationship, Decision, FieldPackResponse, FieldPackStatus, FieldPackSummary, Handover,
  HandoverInput, List, MyPerformance, OnCallShift, PromiseKeepingReport, QuickApprovalCard, QuickMessageRequest, QuickTemplate, Team, TeamInput,
  TeamPerformanceReport, UserTeamSettings,
} from '@mice/shared';
import { request } from './client';

const enc = encodeURIComponent;
const items = async <T>(p: Promise<List<T>>) => (await p).items;
type QH = UserTeamSettings['quietHours'];

export const teamApi = {
  quickApprovals: () => items(request<List<QuickApprovalCard>>('GET', '/quick-approvals')),
  batchApprove: (ids: string[], device?: string) => request<BatchApproveResponse>('POST', '/decisions/batch-approve', { ids, device }),
  quickTemplates: () => items(request<List<QuickTemplate>>('GET', '/quick-templates')),
  quickMessage: (projectId: string, b: QuickMessageRequest) => request<Decision>('POST', `/projects/${enc(projectId)}/quick-messages`, b),

  onCall: () => items(request<List<OnCallShift>>('GET', '/on-call')),
  onCallNow: () => request<{ shift: OnCallShift | null }>('GET', '/on-call/now'),
  addShift: (b: { userId: string; startsAt: string; endsAt: string; note?: string }) => request<OnCallShift>('POST', '/on-call', b),
  cancelShift: (id: string) => request<{ ok: true }>('POST', `/on-call/${enc(id)}/cancel`),

  teams: () => items(request<List<Team>>('GET', '/teams')),
  createTeam: (b: TeamInput) => request<Team>('POST', '/teams', b),
  updateTeam: (id: string, b: Partial<TeamInput> & { active?: boolean }) => request<Team>('PATCH', `/teams/${enc(id)}`, b),
  userSettings: () => items(request<List<UserTeamSettings>>('GET', '/team-settings/users')),
  patchUserSettings: (id: string, b: Partial<Pick<UserTeamSettings, 'teamId' | 'deputyUserId' | 'personalAccountAllowed' | 'quietHours'>>) =>
    request<UserTeamSettings>('PATCH', `/team-settings/users/${enc(id)}`, b),
  myPreferences: () => request<{ quietHours: QH; agencyQuietHours: { enabled: boolean; start: string; end: string } }>('GET', '/me/preferences'),
  setMyPreferences: (quietHours: QH) => request<{ quietHours: QH; agencyQuietHours: { enabled: boolean; start: string; end: string } }>('PATCH', '/me/preferences', { quietHours }),

  myPerformance: () => request<MyPerformance>('GET', '/me/performance'),
  myTeamPerformance: () => request<TeamPerformanceReport>('GET', '/reports/my-team-performance'),
  promiseKeeping: () => request<PromiseKeepingReport>('GET', '/reports/promise-keeping'),

  disclosures: (customerId: string) => items(request<List<CustomerDisclosure>>('GET', `/customers/${enc(customerId)}/disclosures`)),
  grantDisclosure: (customerId: string, b: { supplierId: string; reason: string }) => request<CustomerDisclosure>('POST', `/customers/${enc(customerId)}/disclosures`, b),
  revokeDisclosure: (id: string, reason?: string) => request<CustomerDisclosure>('POST', `/disclosures/${enc(id)}/revoke`, { reason }),
  relationships: () => items(request<List<CustomerRelationship>>('GET', '/customer-relationships')),
  setRelationship: (customerId: string, b: { ownerId?: string | null; backupId?: string | null }) => request<CustomerRelationship>('PATCH', `/customers/${enc(customerId)}/relationship`, b),

  participantMessaging: (projectId: string) => request<{ mode: 'off' | 'logistics' | 'on'; source: 'project' | 'agency' }>('GET', `/projects/${enc(projectId)}/participant-messaging`),
  setParticipantMessaging: (projectId: string, mode: 'off' | 'logistics' | 'on', reason: string) => request<{ mode: string }>('PATCH', `/projects/${enc(projectId)}/participant-messaging`, { mode, reason }),
  forward: (projectId: string, b: { text: string; source: 'whatsapp' | 'email' | 'other'; from?: string }) => request<{ id: string }>('POST', `/projects/${enc(projectId)}/forward`, b),

  handovers: () => items(request<List<Handover>>('GET', '/handovers')),
  handover: (id: string) => request<Handover>('GET', `/handovers/${enc(id)}`),
  startHandover: (b: HandoverInput) => request<Handover>('POST', '/handovers', b),
  markRead: (id: string, projectId: string) => request<Handover>('POST', `/handovers/${enc(id)}/read`, { projectId }),
  refreshHandover: (id: string) => request<Handover>('POST', `/handovers/${enc(id)}/refresh`),
  cancelHandover: (id: string) => request<Handover>('POST', `/handovers/${enc(id)}/cancel`),

  issuePack: (date?: string) => request<FieldPackResponse>('POST', '/field/packs', date ? { date } : {}),
  packStatus: (id: string) => request<FieldPackStatus>('GET', `/field/packs/${enc(id)}/status`),
  packs: () => items(request<List<FieldPackSummary>>('GET', '/field/packs')),
  revokePack: (id: string, reason?: string) => request<FieldPackSummary>('POST', `/field/packs/${enc(id)}/revoke`, { reason }),
};
