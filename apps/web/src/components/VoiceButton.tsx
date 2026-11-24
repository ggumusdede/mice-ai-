import { useEffect, useState } from 'react';
import { DEFAULT_RULES } from '@mice/shared';
import { api } from '../api/client';
import { useSpeech } from '../lib/speech';
import { useT } from '../i18n';
import { Icon } from './Icon';

// v0.5 S-25: voice is OFF by default (the browser may send audio to a third-party service); the admin enables it per agency.
let voiceRule: Promise<boolean> | null = null;
function voiceEnabled(): Promise<boolean> {
  voiceRule ??= api.rules.get().then((r) => r.voiceFeaturesEnabled ?? DEFAULT_RULES.voiceFeaturesEnabled).catch(() => { voiceRule = null; return false; });
  return voiceRule;
}

/** Mic toggle using Web Speech API (tr-TR). Hidden gracefully when unsupported or turned off by the agency (S-25). */
export function VoiceButton({ onText, compact = false }: { onText: (text: string) => void; compact?: boolean }) {
  const t = useT();
  const s = useSpeech(onText);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void voiceEnabled().then((v) => alive && setEnabled(v));
    return () => { alive = false; };
  }, []);
  if (!enabled) return null;
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
