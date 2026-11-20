import { createContext, useContext } from 'react';
import type { ProjectDetail, ServiceItemDetail } from '@mice/shared';

export interface ProjectCtx {
  detail: ProjectDetail;
  reload: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const v = useContext(ProjectContext);
  if (!v) throw new Error('useProject outside ProjectContext');
  return v;
}

/** Selected offer (or the cheapest latest version) per item, used by quote builder and contracts. */
export function latestOffers(item: ServiceItemDetail) {
  return item.offers.filter((o) => !o.supersededBy);
}

export function itemTitle(item: { kind: string; description: string }, kindLabel: string) {
  return item.description || kindLabel;
}
