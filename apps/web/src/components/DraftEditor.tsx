import { useState } from 'react';
import { labelFor } from './DetailView';

/** Field-by-field editor for Decision.draft ("Düzelt"). Unknown shapes are edited as JSON. */
export function DraftEditor({ draft, onChange }: { draft: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: unknown) => onChange({ ...draft, [k]: v });
  return (
    <div className="stack">
      {Object.entries(draft).map(([k, v]) => {
        const id = `draft-${k}`;
        if (typeof v === 'boolean') {
          return (
            <div className="check" key={k}>
              <input id={id} type="checkbox" checked={v} onChange={(e) => set(k, e.target.checked)} />
              <label htmlFor={id}>{labelFor(k)}</label>
            </div>
          );
        }
        if (typeof v === 'number') {
          const frac = /(margin|markup|rate|advantage)$/i.test(k) && Math.abs(v) <= 1.5;
          return (
            <div className="field" key={k}>
              <label className="field__label" htmlFor={id}>{labelFor(k)}{frac ? ' (%)' : ''}</label>
              <input
                id={id}
                className="input"
                type="number"
                step="any"
                inputMode="decimal"
                value={frac ? +(v * 100).toFixed(4) : v}
                onChange={(e) => set(k, frac ? Number(e.target.value) / 100 : Number(e.target.value))}
              />
            </div>
          );
        }
        if (typeof v === 'string' || v === null) {
          const s = v ?? '';
          const long = s.length > 60 || s.includes('\n') || /body|message|text|note/i.test(k);
          return (
            <div className="field" key={k}>
              <label className="field__label" htmlFor={id}>{labelFor(k)}</label>
              {long ? (
                <textarea id={id} className="input textarea" rows={Math.min(14, Math.max(4, s.split('\n').length + 1))} value={s} onChange={(e) => set(k, e.target.value)} />
              ) : (
                <input id={id} className="input" value={s} onChange={(e) => set(k, e.target.value)} />
              )}
            </div>
          );
        }
        return (
          <div className="field" key={k}>
            <label className="field__label" htmlFor={id}>{labelFor(k)} (JSON)</label>
            <textarea
              id={id}
              className="input textarea mono"
              rows={6}
              defaultValue={JSON.stringify(v, null, 2)}
              onChange={(e) => {
                try {
                  set(k, JSON.parse(e.target.value));
                  setJsonErrors(({ [k]: _drop, ...rest }) => rest);
                } catch {
                  setJsonErrors((x) => ({ ...x, [k]: 'Geçersiz JSON' }));
                }
              }}
            />
            {jsonErrors[k] ? <p className="inline-error">{jsonErrors[k]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
