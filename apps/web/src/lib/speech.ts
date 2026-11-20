// Web Speech API (tr-TR) — sesli not / sesli komut (§15). Not in TS DOM lib, so minimal typings here.
import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechAlternative { transcript: string; confidence: number }
interface SpeechResult { isFinal: boolean; length: number; [i: number]: SpeechAlternative }
interface SpeechResultEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return getCtor() !== null;
}

/**
 * Dictation hook. `onFinal` receives each finalized chunk; `interim` holds the live partial text.
 */
export function useSpeech(onFinal: (text: string) => void, lang = 'tr-TR') {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const supported = speechSupported();

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError('unsupported');
      return;
    }
    setError(null);
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) cbRef.current(text.trim());
        else partial += text;
      }
      setInterim(partial);
    };
    rec.onerror = (e) => setError(e.error);
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [lang]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, toggle: listening ? stop : start };
}
