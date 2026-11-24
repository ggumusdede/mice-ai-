import { createContext, useContext, type ReactNode } from 'react';
import { tr, type Dict } from './tr';

/** Add `en`, `ru` dictionaries of type Dict here. */
export const dictionaries: Record<string, Dict> = { tr };

const I18nContext = createContext<Dict>(tr);

export function I18nProvider({ lang = 'tr', children }: { lang?: string; children: ReactNode }) {
  return <I18nContext.Provider value={dictionaries[lang] ?? tr}>{children}</I18nContext.Provider>;
}

export function useT(): Dict {
  return useContext(I18nContext);
}

export { tr };
export type { Dict };
