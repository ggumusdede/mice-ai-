import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { INBOUND_CHANNELS, type Extracted, type InboundChannel, type IntakeResponse, type Project, type RequestExtraction } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { useT } from '../i18n';
import { num, pct } from '../lib/format';
import { PageHeader } from '../components/AppShell';
import { VoiceButton } from '../components/VoiceButton';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, Callout, Card, ConfidenceTag, InlineError, Pill, Segmented, TextInput } from '../components/ui';

/** Extraction key → Project field (for human verification PATCH). */
const FIELD_MAP: Record<string, keyof Project> = {
  customerName: 'customerName', eventType: 'eventType', startDate: 'startDate', endDate: 'endDate', dateFlexibility: 'dateFlexibility',
  pax: 'pax', roomsSgl: 'roomsSgl', roomsDbl: 'roomsDbl', city: 'city', district: 'district', hallLayout: 'hallLayout',
  fnb: 'fnbNeeds', technical: 'technicalNeeds', transfer: 'transferNeeds', budget: 'budget', budgetCurrency: 'budgetCurrency',
  decisionDate: 'decisionDate', billingInfo: 'billingInfo',
};
const NUMERIC = new Set(['pax', 'roomsSgl', 'roomsDbl', 'budget']);
const DATE = new Set(['startDate', 'endDate', 'decisionDate']);
const THRESHOLD = 0.8;

export function IntakePage() {
  const t = useT();
  const [channel, setChannel] = useState<InboundChannel>('email');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResponse | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.intake({ channel, body, fromAddress: from || undefined, subject: subject || undefined, receivedAt: new Date().toISOString() }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader title={t.intake.title} subtitle={t.intake.subtitle} />
      <Card>
        <form onSubmit={submit} className="stack">
          <div className="field">
            <span className="field__label" id="ch-label">{t.intake.channel}</span>
            <Segmented
              label={t.intake.channel}
              value={channel}
              onChange={setChannel}
              options={INBOUND_CHANNELS.filter((c) => c !== 'manual').map((c) => ({ value: c, label: t.channel[c] }))}
            />
          </div>
          <div className="grid-2">
            <TextInput label={t.intake.from} value={from} onChange={(e) => setFrom(e.target.value)} />
            {channel === 'email' ? <TextInput label={t.intake.subject} value={subject} onChange={(e) => setSubject(e.target.value)} /> : <span />}
          </div>
          <div className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor="intake-body">{t.intake.body}</label>
              <VoiceButton
                onText={(txt) => {
                  setBody((b) => (b ? `${b} ${txt}` : txt));
                  setChannel((c) => (c === 'email' || c === 'whatsapp' ? 'voice' : c));
                }}
              />
            </div>
            <textarea id="intake-body" className="input textarea" rows={9} placeholder={t.intake.bodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} required />
          </div>
          <InlineError message={error} />
          <div className="row-end">
            <Button type="submit" size="lg" icon="sparkle" busy={busy} disabled={!body.trim()}>
              {busy ? t.intake.analyzing : t.intake.analyze}
            </Button>
          </div>
        </form>
      </Card>

      {result ? <IntakeResult r={result} onProject={(p) => setResult({ ...result, project: p })} /> : null}
    </div>
  );
}

function IntakeResult({ r, onProject }: { r: IntakeResponse; onProject: (p: Project) => void }) {
  const t = useT();
  const toast = useToast();
  const ex = r.project.extraction;
  const [draftBody, setDraftBody] = useState(r.questionDraft?.body ?? '');
  const [draftBusy, setDraftBusy] = useState(false);
  const [assigned, setAssigned] = useState(false);

  return (
    <div className="stack stack--lg" aria-live="polite">
      <Card
        title={<><span className="mono">{r.project.code}</span></>}
        actions={<Link to={`/projeler/${r.project.id}`} className="btn btn--secondary">{t.intake.openProject}<Icon name="chevronRight" size={16} /></Link>}
      >
        {r.rfqReady ? (
          <Callout tone="success" icon="check">{t.intake.rfqReady}</Callout>
        ) : (
          <Callout tone="warning" icon="alert">{t.intake.rfqNotReady}</Callout>
        )}
        {r.duplicates.length ? (
          <Callout tone="danger" icon="alert" title={t.intake.duplicates}>
            <ul className="bullets">
              {r.duplicates.map((d) => (
                <li key={d.projectId}><Link to={`/projeler/${d.projectId}`} className="mono">{d.code}</Link> — {d.reason}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </Card>

      {ex ? (
        <Card title={t.intake.extracted}>
          <div className="extract-grid">
            {Object.entries(ex)
              .filter(([k]) => k !== 'language')
              .map(([k, v]) => (
                <ExtractedField key={k} name={k} value={v as Extracted<unknown>} projectId={r.project.id} onProject={onProject} />
              ))}
          </div>
        </Card>
      ) : null}

      {(r.missingFields.length || r.questionDraft) ? (
        <Card title={t.intake.missing}>
          {r.missingFields.length ? (
            <div className="chips">
              {r.missingFields.map((m) => <Pill key={m} tone="warning">{t.extractionField[m] ?? m}</Pill>)}
            </div>
          ) : null}
          {r.missingQuestions.length ? (
            <ul className="bullets">{r.missingQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          ) : null}
          {r.questionDraft ? (
            <div className="field">
              <label className="field__label" htmlFor="qdraft">{t.intake.questionDraft}</label>
              <textarea id="qdraft" className="input textarea" rows={7} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
              <div className="row-end">
                <Button
                  variant="secondary"
                  busy={draftBusy}
                  onClick={async () => {
                    setDraftBusy(true);
                    try {
                      await api.drafts.patch(r.questionDraft!.id, { body: draftBody, subject: r.questionDraft!.subject });
                      toast(t.common.saved);
                    } catch (e) {
                      toast(errorMessage(e), 'danger');
                    } finally {
                      setDraftBusy(false);
                    }
                  }}
                >
                  {t.intake.saveDraft}
                </Button>
                <Button
                  icon="send"
                  busy={draftBusy}
                  onClick={async () => {
                    setDraftBusy(true);
                    try {
                      if (draftBody !== r.questionDraft!.body) await api.drafts.patch(r.questionDraft!.id, { body: draftBody, subject: r.questionDraft!.subject });
                      await api.drafts.send(r.questionDraft!.id);
                      toast(t.common.send);
                    } catch (e) {
                      toast(errorMessage(e), 'danger');
                    } finally {
                      setDraftBusy(false);
                    }
                  }}
                >
                  {t.intake.sendDraft}
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid-2">
        <Card title={t.intake.preMatched}>
          {r.preMatchedSuppliers.length ? (
            <ul className="list">
              {r.preMatchedSuppliers.map((s) => (
                <li key={s.supplier.id} className="list__row">
                  <div>
                    <strong>{s.supplier.name}</strong>
                    <div className="muted small">{[s.supplier.city, s.supplier.district].filter(Boolean).join(' / ')} · {s.reasons.join(', ')}</div>
                  </div>
                  <div className="list__end">
                    {s.sameDistrict ? <Pill tone="success">{t.intake.sameDistrict}</Pill> : null}
                    {s.candidate ? <Pill tone="warning">{t.intake.candidate}</Pill> : null}
                    <Pill>{num(s.score)}</Pill>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="muted">—</p>}
        </Card>
        <Card title={t.intake.assignment}>
          {r.assignmentSuggestion ? (
            <div className="stack">
              <p><strong>{r.assignmentSuggestion.fullName}</strong></p>
              <p className="muted">{r.assignmentSuggestion.reason}</p>
              <div>
                <Button
                  variant="secondary"
                  icon="user"
                  disabled={assigned}
                  onClick={async () => {
                    try {
                      onProject(await api.projects.assign(r.project.id, r.assignmentSuggestion!.userId));
                      setAssigned(true);
                      toast(t.common.saved);
                    } catch (e) {
                      toast(errorMessage(e), 'danger');
                    }
                  }}
                >
                  {assigned ? t.common.saved : t.common.approve}
                </Button>
              </div>
            </div>
          ) : <p className="muted">—</p>}
        </Card>
      </div>
    </div>
  );
}

function ExtractedField({ name, value, projectId, onProject }: { name: string; value: Extracted<unknown>; projectId: string; onProject: (p: Project) => void }) {
  const t = useT();
  const low = value.needsReview ?? value.confidence < THRESHOLD;
  const [v, setV] = useState(value.value === null || value.value === undefined ? '' : String(value.value));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = t.extractionField[name] ?? name;
  const projectKey = FIELD_MAP[name as keyof RequestExtraction];
  return (
    <div className={`extract ${low && !saved ? 'extract--low' : ''}`}>
      <div className="extract__head">
        <span className="extract__label">{label}</span>
        {saved ? <Pill tone="success" icon="check">{t.offers.verified}</Pill> : <ConfidenceTag value={value.confidence} threshold={THRESHOLD} />}
      </div>
      {low && projectKey && !saved ? (
        <div className="extract__edit">
          <label className="sr-only" htmlFor={`ex-${name}`}>{label}</label>
          <input
            id={`ex-${name}`}
            className="input input--sm"
            type={DATE.has(name) ? 'date' : NUMERIC.has(name) ? 'number' : 'text'}
            value={v}
            onChange={(e) => setV(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setErr(null);
              try {
                const val = v === '' ? null : NUMERIC.has(name) ? Number(v) : v;
                onProject(await api.projects.patch(projectId, { [projectKey]: val, reason: 'intake_verification' } as Partial<Project>));
                setSaved(true);
              } catch (e) {
                setErr(errorMessage(e));
              }
            }}
          >
            {t.intake.lowConfidence}
          </Button>
        </div>
      ) : (
        <div className="extract__value">{v || <span className="muted">—</span>}</div>
      )}
      {value.source ? <div className="extract__source muted small">“{value.source}”</div> : null}
      {err ? <p className="inline-error">{err}</p> : null}
      <span className="sr-only">{t.common.confidence} {pct(value.confidence)}</span>
    </div>
  );
}
