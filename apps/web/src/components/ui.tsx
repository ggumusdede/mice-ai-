import { useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import type { DecisionBadge, DocumentStatus, ProfitSummary } from '@mice/shared';
import { useT } from '../i18n';
import { confidenceLevel, eur, money, pct } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { ApiClientError } from '../api/client';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'purple';

export function Pill({ tone = 'neutral', children, title, icon }: { tone?: Tone; children: ReactNode; title?: string; icon?: IconName }) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

const BADGE_TONE: Record<DecisionBadge, Tone> = { within_rules: 'success', critical: 'danger', suggestion: 'purple' };
export function DecisionBadgePill({ badge }: { badge: DecisionBadge }) {
  const t = useT();
  return <Pill tone={BADGE_TONE[badge]}>{t.badge[badge]}</Pill>;
}

export function PriceClassPill({ value }: { value: 'good' | 'normal' | 'unknown' | null | undefined }) {
  const t = useT();
  if (!value) return <span className="muted">—</span>;
  const tone: Tone = value === 'good' ? 'success' : value === 'normal' ? 'neutral' : 'warning';
  return <Pill tone={tone}>{t.priceClass[value]}</Pill>;
}

export function DocStatusPill({ status }: { status: DocumentStatus }) {
  const t = useT();
  const tone: Tone = status === 'current' ? 'success' : status === 'stale' ? 'danger' : 'warning';
  return <Pill tone={tone}>{t.docStatus[status]}</Pill>;
}

export function ConfidenceTag({ value, threshold = 0.8 }: { value: number | null | undefined; threshold?: number }) {
  const t = useT();
  const lvl = confidenceLevel(value, threshold);
  if (lvl === 'none') return null;
  return (
    <Pill tone={lvl === 'low' ? 'warning' : 'neutral'} title={`${t.common.confidence}: ${pct(value)}`} icon={lvl === 'low' ? 'alert' : undefined}>
      {pct(value, 0)}
    </Pill>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" aria-hidden />
      {label ? <span className="spinner__label">{label}</span> : <span className="sr-only">Yükleniyor</span>}
    </span>
  );
}

export function Loading() {
  const t = useT();
  return (
    <div className="center-block">
      <Spinner label={t.common.loading} />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const msg = error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : String(error ?? t.common.unknownError);
  return (
    <div className="callout callout--danger" role="alert">
      <Icon name="alert" />
      <div className="callout__body">{msg}</div>
      {onRetry ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="inline-error" role="alert">
      {message}
    </p>
  );
}

export function Callout({ tone = 'neutral', icon = 'info', children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div className="callout__body">
        {title ? <strong className="callout__title">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'check', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={28} />
      </div>
      <h3 className="empty__title">{title}</h3>
      {children ? <p className="empty__body">{children}</p> : null}
      {action}
    </div>
  );
}

export function Button({
  variant = 'primary', size, icon, busy, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain'; size?: 'sm' | 'lg'; icon?: IconName; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={['btn', `btn--${variant}`, size ? `btn--${size}` : '', className ?? ''].join(' ').trim()}
    >
      {busy ? <span className="spinner__dot spinner__dot--inline" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

interface FieldProps { label: ReactNode; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string; warn?: boolean }
export function Field({ label, hint, error, children, className, warn }: FieldProps) {
  const id = useId();
  return (
    <div className={`field ${warn ? 'field--warn' : ''} ${className ?? ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function TextInput({ label, hint, warn, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; warn?: boolean }) {
  return <Field label={label} hint={hint} warn={warn}>{(id) => <input id={id} className="input" {...rest} />}</Field>;
}

export function TextArea({ label, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode }) {
  return <Field label={label} hint={hint}>{(id) => <textarea id={id} className="input textarea" {...rest} />}</Field>;
}

export function Select({ label, hint, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} className="input select" {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        {label}
        {hint ? <span className="check__hint">{hint}</span> : null}
      </label>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segmented__opt ${value === o.value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${padded ? 'card--padded' : ''} ${className ?? ''}`}>
      {title || actions ? (
        <header className="card__head">
          {title ? <h2 className="card__title">{title}</h2> : <span />}
          {actions ? <div className="card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function KeyValues({ rows }: { rows: { k: ReactNode; v: ReactNode; warn?: boolean }[] }) {
  return (
    <dl className="kv">
      {rows.map((r, i) => (
        <div key={i} className={`kv__row ${r.warn ? 'kv__row--warn' : ''}`}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Profit block — margin and markup ALWAYS shown as separate labeled values (§9). */
export function ProfitBlock({ title, value, currency = 'EUR' }: { title: string; value: ProfitSummary | null | undefined; currency?: string }) {
  const t = useT();
  return (
    <div className="profit">
      <h3 className="profit__title">{title}</h3>
      {value ? (
        <>
          <div className="profit__main">
            <span className="profit__amount">{money(value.profitEur, currency)}</span>
            <span className="muted">{t.profit.profit}</span>
          </div>
          <dl className="profit__grid">
            <div><dt>{t.profit.cost}</dt><dd>{money(value.costEur, currency)}</dd></div>
            <div><dt>{t.profit.sale}</dt><dd>{money(value.saleEur, currency)}</dd></div>
            <div><dt title={t.profit.margin}>{t.profit.marginShort}</dt><dd className="num-strong">{pct(value.margin)}</dd></div>
            <div><dt title={t.profit.markup}>{t.profit.markupShort}</dt><dd className="num-strong">{pct(value.markup)}</dd></div>
          </dl>
          <p className="profit__legend">{t.profit.margin} · {t.profit.markup}</p>
        </>
      ) : (
        <p className="muted">—</p>
      )}
    </div>
  );
}

export function MarginMarkup({ cost, sale }: { cost: number; sale: number }) {
  const t = useT();
  const profit = sale - cost;
  const margin = sale ? profit / sale : 0;
  const markup = cost ? profit / cost : 0;
  return (
    <span className="mm">
      <span><span className="mm__k">{t.profit.marginShort}</span> {pct(margin)}</span>
      <span><span className="mm__k">{t.profit.markupShort}</span> {pct(markup)}</span>
    </span>
  );
}

export function FilePicker({ label, accept, onFile, disabled, icon = 'upload' }: { label: string; accept?: string; onFile: (f: File) => void; disabled?: boolean; icon?: IconName }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="file-picker">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setName(f.name);
            onFile(f);
          }
          e.target.value = '';
        }}
      />
      <Button variant="secondary" icon={icon} disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      {name ? <span className="muted small">{name}</span> : null}
    </span>
  );
}

export function CopyLink({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
  return (
    <span className="copy-link">
      <a href={full} target="_blank" rel="noreferrer" className="copy-link__url">
        {full}
      </a>
      <Button
        variant="ghost"
        size="sm"
        icon={copied ? 'check' : 'link'}
        onClick={() => {
          void navigator.clipboard?.writeText(full).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t.common.copied : t.common.copy}
      </Button>
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub ? <div className="stat__sub">{sub}</div> : null}
    </div>
  );
}

export { eur };
