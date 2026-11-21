// "Bildirimleri aç" control in the profile sheet (§15). iOS needs the app on the home screen first → hint instead.
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Button, Callout } from './ui';
import { useToast } from './Toast';
import { errorMessage } from '../api/client';
import { currentPushState, disablePush, enablePush, type PushState } from '../lib/push';

export function PushToggle() {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    currentPushState().then((s) => alive && setState(s)).catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, []);
  if (!state || state === 'unsupported') return null;
  if (state === 'ios_needs_install') return <Callout tone="neutral" icon="bell">{t.inbox.pushIosHint}</Callout>;
  if (state === 'disabled_on_server') return null;
  if (state === 'denied') return <Callout tone="neutral" icon="bell">{t.inbox.pushDenied}</Callout>;
  const on = state === 'on';
  return (
    <div className="stack">
      <Button
        variant="secondary"
        icon="bell"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const next = on ? await disablePush() : await enablePush();
            setState(next);
            if (next === 'on') toast(t.inbox.pushEnabled);
            else if (next === 'off' && on) toast(t.inbox.pushDisabled);
            else if (next === 'denied') toast(t.inbox.pushDenied, 'danger');
            else if (next === 'disabled_on_server') toast(t.inbox.pushUnavailable, 'danger');
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        {on ? t.inbox.pushDisable : t.inbox.pushEnable}
      </Button>
      <p className="muted">{t.inbox.pushHelp}</p>
    </div>
  );
}
