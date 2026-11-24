import type { ReactNode } from 'react';
import { useT } from '../i18n';

/** Minimal layout for token pages (supplier / customer / guest) — agency branding, no app chrome. */
export function PublicLayout({ agencyName, title, subtitle, children }: { agencyName?: string | null; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="public">
      <header className="public__head">
        <div className="public__brand">
          <span className="public__logo" aria-hidden>{(agencyName ?? 'A').slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
          <span className="public__agency">{agencyName ?? ''}</span>
        </div>
      </header>
      <main className="public__main" id="main">
        <h1 className="public__title">{title}</h1>
        {subtitle ? <div className="public__sub">{subtitle}</div> : null}
        {children}
      </main>
      <footer className="public__foot">{t.publicPages.poweredBy}</footer>
    </div>
  );
}
