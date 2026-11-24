import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { PublicLayout } from '../../components/PublicLayout';
import { Button, Callout, InlineError, Loading } from '../../components/ui';
import { InvalidLink } from './InvalidLink';

/** §7 Adım 8: 3-question customer survey. */
export function SurveyPage() {
  const t = useT();
  const { token = '' } = useParams();
  const res = useApi(() => api.public.survey(token), [token]);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (res.error && !res.data) return <InvalidLink error={res.error} />;
  if (!res.data) return <PublicLayout title={t.publicPages.surveyTitle}><Loading /></PublicLayout>;
  const v = res.data;
  const complete = v.questions.filter((q) => q.type === 'rating').every((q) => typeof answers[q.id] === 'number');

  return (
    <PublicLayout agencyName={v.agencyName} title={t.publicPages.surveyTitle} subtitle={<span className="mono">{v.projectCode}</span>}>
      {done || v.submitted ? (
        <Callout tone="success" icon="check">{t.publicPages.surveyThanks}</Callout>
      ) : (
        <form
          className="stack stack--lg"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.public.submitSurvey(token, { answers });
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="muted">{t.publicPages.surveyIntro}</p>
          {v.questions.map((q, i) => (
            <fieldset key={q.id} className="card card--padded survey-q">
              <legend className="survey-q__title">{i + 1}. {q.text}</legend>
              {q.type === 'rating' ? (
                <div className="rating" role="radiogroup" aria-label={q.text}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.id] === n}
                      aria-label={`${n} / 5`}
                      className={`rating__btn ${typeof answers[q.id] === 'number' && (answers[q.id] as number) >= n ? 'is-on' : ''}`}
                      onClick={() => setAnswers({ ...answers, [q.id]: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea aria-label={q.text} className="input textarea" rows={3} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              )}
            </fieldset>
          ))}
          <InlineError message={error} />
          <Button type="submit" size="lg" className="btn--block" busy={busy} disabled={!complete}>{t.publicPages.surveySubmit}</Button>
        </form>
      )}
    </PublicLayout>
  );
}
