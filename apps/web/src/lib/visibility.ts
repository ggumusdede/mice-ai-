// Least privilege in the UI ([Ürün kararı] `fieldRoleCanSeeFinancials`, default false). The API already redacts / refuses
// (security review G-16); the UI only hides what the role cannot get, so a field user does not meet empty tabs or 403s.
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

export function useCanSeeFinancials(): boolean {
  const { user } = useAuth();
  const isField = user?.role === 'field';
  const rules = useApi(() => api.rules.get(), [isField], { enabled: isField });
  if (!isField) return true;
  return rules.data?.fieldRoleCanSeeFinancials === true;
}

/** Project tabs that only show money (offers, comparison, quote, contracts, finance, closing). */
export const FINANCIAL_TABS: readonly string[] = ['offers', 'comparison', 'quote', 'contracts', 'finance', 'closing'];
