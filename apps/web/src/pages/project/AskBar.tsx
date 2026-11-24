import { useState, type FormEvent } from 'react';
import type { AskResponse } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { pct } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { VoiceButton } from '../../components/VoiceButton';
import { Spinner } from '../../components/ui';

/** Fixed bottom "Bu projeye sor" bar (text + voice) — POST /api/projects/:id/ask. */
export function AskBar({ projectId }: { projectId: string }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<(AskResponse & { question: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.projects.ask(projectId, question);
      setAnswer({ ...r, question });
      setQ('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="askbar">
      {answer || error || busy ? (
        <div className="askbar__answer" aria-live="polite">
          <button type="button" className="icon-btn askbar__close" aria-label={t.common.close} onClick={() => { setAnswer(null); setError(null); }}>
            <Icon name="x" size={16} />
          </button>
          {busy ? <Spinner label={t.common.loading} /> : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {answer && !busy ? (
            <>
              <p className="askbar__q">{answer.question}</p>
              <p className="pre-line">{answer.answer}</p>
              <div className="askbar__meta">
                <span className="muted small">{t.common.confidence}: {pct(answer.confidence, 0)}</span>
                {answer.sources.length ? (
                  <span className="muted small">
                    {t.project.askSources}: {answer.sources.map((s) => s.label).join(' · ')}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <form className="askbar__form" onSubmit={ask}>
        <Icon name="sparkle" size={18} className="askbar__icon" />
        <label htmlFor="askbar-input" className="sr-only">{t.project.ask}</label>
        <input
          id="askbar-input"
          className="askbar__input"
          placeholder={`${t.project.ask} — ${t.project.askPlaceholder}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <VoiceButton compact onText={(txt) => setQ((x) => (x ? `${x} ${txt}` : txt))} />
        <button type="submit" className="icon-btn icon-btn--accent" disabled={!q.trim() || busy} aria-label={t.common.send}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
}
