import { WORKFLOW_STEPS, type WorkflowStep } from '@mice/shared';

/** 0–8 workflow progress bar (§15 masaüstü proje ekranı). */
export function StepProgress({ step, compact = false }: { step: WorkflowStep; compact?: boolean }) {
  const current = WORKFLOW_STEPS.find((s) => s.step === step);
  return (
    <div className={`steps ${compact ? 'steps--compact' : ''}`}>
      <ol className="steps__list" aria-label={`İş akışı: adım ${step} / 8 — ${current?.label ?? ''}`}>
        {WORKFLOW_STEPS.map((s) => {
          const state = s.step < step ? 'done' : s.step === step ? 'current' : 'todo';
          return (
            <li key={s.step} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="steps__dot">{s.step}</span>
              {!compact ? <span className="steps__label">{s.label}</span> : null}
            </li>
          );
        })}
      </ol>
      {compact && current ? <span className="steps__current">{current.step} · {current.label}</span> : null}
    </div>
  );
}

export function stepLabel(step: number): string {
  return WORKFLOW_STEPS.find((s) => s.step === step)?.label ?? String(step);
}
