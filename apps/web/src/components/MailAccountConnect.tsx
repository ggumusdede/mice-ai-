// Profile sheet: "E-posta hesabını bağla" (Google / Microsoft) — per-user OAuth mailbox for §3.3 sending from the user's own
// address — plus the user's own phone for the §15 critical-notification fallback (WhatsApp / SMS).
import { useEffect, useState } from 'react';
import { errorMessage, request } from '../api/client';
import { Button, Callout } from './ui';
import { useToast } from './Toast';

interface MailAccount { id: string; provider: 'google' | 'microsoft'; emailAddress: string; status: 'active' | 'needs_reauth'; lastError: string | null }
interface MailAccountsResponse { items: MailAccount[]; providers: { google: boolean; microsoft: boolean }; emailProvider: string; fallback: string }

const PROVIDER_LABEL = { google: 'Google', microsoft: 'Microsoft' } as const;
const REASON: Record<string, string> = {
  mailbox_mismatch: 'Bağlanan posta kutusu giriş adresinizle aynı olmalı.', personal_account_blocked: 'Yalnız kurumsal posta kutusu bağlanabilir; kişisel hesap için yöneticinizden istisna isteyin.', state_expired: 'Bağlantı süresi doldu, yeniden deneyin.',
  invalid_state: 'Geçersiz bağlantı isteği.', denied: 'İzin verilmedi.', no_refresh_token: 'Sağlayıcı kalıcı izin vermedi; yeniden deneyin.',
};

export function MailAccountConnect() {
  const toast = useToast();
  const [data, setData] = useState<MailAccountsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneLive, setPhoneLive] = useState(false);
  const load = () => request<MailAccountsResponse>('GET', '/mail/accounts').then(setData).catch(() => setData(null));
  useEffect(() => {
    load();
    request<{ phone: string | null; channelLive: boolean }>('GET', '/me/notify-phone').then((r) => { setPhone(r.phone ?? ''); setPhoneLive(r.channelLive); }).catch(() => undefined);
    // result of the OAuth redirect (?mail_oauth=connected|error&reason=…)
    const q = new URLSearchParams(window.location.search);
    const r = q.get('mail_oauth');
    if (r) {
      toast(r === 'connected' ? `E-posta hesabı bağlandı: ${q.get('address') ?? ''}` : `E-posta hesabı bağlanamadı. ${REASON[q.get('reason') ?? ''] ?? ''}`, r === 'connected' ? undefined : 'danger');
      ['mail_oauth', 'reason', 'provider', 'address'].forEach((k) => q.delete(k));
      window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const oauthOn = !!data && (data.providers.google || data.providers.microsoft);
  if (!data || (!oauthOn && !phoneLive)) return null;
  const acc = oauthOn ? data.items[0] : undefined;
  return (
    <div className="stack">
      {!oauthOn ? null : acc ? (
        <Callout tone={acc.status === 'active' ? 'neutral' : 'danger'} icon="link">
          {acc.status === 'active' ? `E-posta: ${acc.emailAddress} (${PROVIDER_LABEL[acc.provider]}) bağlı — mesajlarınız bu posta kutusundan gider.` : `E-posta hesabınızın izni sona erdi (${acc.emailAddress}); yeniden bağlayın.`}
        </Callout>
      ) : (
        <p className="muted">E-posta hesabınız bağlı değil{data.emailProvider === 'oauth' ? (data.fallback === 'hold' ? ' — gönderdiğiniz e-postalar bağlayana kadar bekletilir.' : ' — e-postalar acenta sunucusu üzerinden gider.') : '.'}</p>
      )}
      {!oauthOn ? null : (['google', 'microsoft'] as const).filter((p) => data.providers[p]).map((p) => (
        <Button key={p} variant="secondary" icon="link" busy={busy === p} onClick={async () => {
          setBusy(p);
          try {
            const r = await request<{ url: string }>('GET', `/mail/oauth/${p}/start`);
            window.location.assign(r.url);
          } catch (e) {
            toast(errorMessage(e), 'danger');
            setBusy(null);
          }
        }}>
          {acc ? `${PROVIDER_LABEL[p]} ile yeniden bağla` : `E-posta hesabını bağla (${PROVIDER_LABEL[p]})`}
        </Button>
      ))}
      {acc ? (
        <Button variant="secondary" icon="x" busy={busy === 'off'} onClick={async () => {
          setBusy('off');
          try {
            await request('POST', `/mail/accounts/${acc.id}/disconnect`, {});
            toast('E-posta hesabı ayrıldı');
            await load();
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(null);
          }
        }}>E-posta hesabını ayır</Button>
      ) : null}
      {phoneLive ? <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Yedek bildirim telefonu (WhatsApp / SMS)" aria-label="Yedek bildirim telefonu"
        value={phone} onChange={(e) => setPhone(e.target.value)}
        onBlur={() => request<{ phone: string | null }>('POST', '/me/notify-phone', { phone: phone.trim() || null }).then((r) => setPhone(r.phone ?? '')).catch((e) => toast(errorMessage(e), 'danger'))} /> : null}
    </div>
  );
}
