// v0.5-A "Para ve tedarik çekirdeği" — typed client for the additive contract in @mice/shared (S-19 settings, S-03 procurement,
// S-06 kapora önce).
import type {
  AllotmentBlock, AllotmentInput, ContractRate, ContractRateInput, FinanceEntry, List, SupplierOption, SupplierOptionInput, TenantSettings,
} from '@mice/shared';
import { request } from './client';

const enc = encodeURIComponent;
const items = async <T>(p: Promise<List<T>>) => (await p).items;
const qs = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const moneyApi = {
  settings: () => request<TenantSettings>('GET', '/settings'),
  requestBaseCurrency: (currency: string, reason: string) => request<{ decisionId: string }>('POST', '/settings/base-currency', { currency, reason }),

  contractRates: (supplierId?: string) => items(request<List<ContractRate>>('GET', `/contract-rates${qs({ supplierId })}`)),
  createContractRate: (b: ContractRateInput) => request<ContractRate>('POST', '/contract-rates', b),
  archiveContractRate: (id: string) => request<ContractRate>('POST', `/contract-rates/${enc(id)}/archive`),

  allotments: (projectId?: string) => items(request<List<AllotmentBlock>>('GET', `/allotments${qs({ projectId })}`)),
  createAllotment: (b: AllotmentInput) => request<AllotmentBlock>('POST', '/allotments', b),
  pickup: (id: string, rooms: number, date?: string) => request<AllotmentBlock>('POST', `/allotments/${enc(id)}/pickup`, { rooms, ...(date ? { date } : {}) }),
  release: (id: string, rooms: number, reason?: string) => request<AllotmentBlock>('POST', `/allotments/${enc(id)}/release`, { rooms, reason }),

  options: (projectId: string) => items(request<List<SupplierOption>>('GET', `/projects/${enc(projectId)}/options`)),
  createOption: (projectId: string, b: SupplierOptionInput) => request<SupplierOption & { warning: string | null }>('POST', `/projects/${enc(projectId)}/options`, b),
  requestExtension: (id: string) => request<{ draftId: string; decisionId: string }>('POST', `/options/${enc(id)}/extension-request`, {}),
  markExtended: (id: string, optionUntil: string) => request<SupplierOption>('POST', `/options/${enc(id)}/extended`, { optionUntil }),
  setOptionStatus: (id: string, status: 'released' | 'confirmed') => request<SupplierOption>('POST', `/options/${enc(id)}/status`, { status }),

  /** S-06: payment request with the "kapora önce" exception reason (409 DEPOSIT_FIRST_REASON_REQUIRED without it) */
  paymentRequest: (entryId: string, depositFirstReason?: string) => request<FinanceEntry>('POST', '/finance/payment-requests', { entryId, ...(depositFirstReason ? { depositFirstReason } : {}) }),
};
