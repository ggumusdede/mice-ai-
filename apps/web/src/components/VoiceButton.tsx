import { useSpeech } from '../lib/speech';
import { useT } from '../i18n';
import { Icon } from './Icon';

/** Mic toggle using Web Speech API (tr-TR). Hidden gracefully when unsupported. */
export function VoiceButton({ onText, compact = false }: { onText: (text: string) => void; compact?: boolean }) {
  const t = useT();
  const s = useSpeech(onText);
  if (!s.supported) {
    return compact ? null : <span className="muted small">{t.intake.voiceUnsupported}</span>;
  }
  return (
    <span className="voice">
      <button
        type="button"
        className={`voice__btn ${s.listening ? 'is-listening' : ''} ${compact ? 'voice__btn--compact' : ''}`}
        onClick={s.toggle}
        aria-pressed={s.listening}
        aria-label={s.listening ? t.intake.voiceStop : t.intake.voice}
        title={s.listening ? t.intake.voiceStop : t.intake.voice}
      >
        <Icon name="mic" size={compact ? 18 : 20} />
        {!compact ? <span>{s.listening ? t.intake.voiceStop : t.intake.voice}</span> : null}
      </button>
      {s.listening ? (
        <span className="voice__live" aria-live="polite">
          {s.interim || t.intake.listening}
        </span>
      ) : null}
    </span>
  );
}
