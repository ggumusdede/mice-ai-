import { useState } from 'react';
import { api, errorMessage, setToken } from '../api/client';
import { useToast } from './Toast';
import { Button } from './ui';

/** Password change (security review G-17): the server ends every other session; this one continues with a fresh token. */
export function PasswordChange() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button variant="ghost" icon="shield" onClick={() => setOpen(true)}>Şifre değiştir</Button>;
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const r = await api.auth.changePassword(current, next);
        setToken(r.token);
        toast('Şifre değişti; diğer cihazlardaki oturumlar kapatıldı');
        setOpen(false);
        setCurrent('');
        setNext('');
      } catch (err) {
        toast(errorMessage(err), 'danger');
      } finally {
        setBusy(false);
      }
    }}>
      <input type="password" className="input" autoComplete="current-password" placeholder="Mevcut şifre" aria-label="Mevcut şifre" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <input type="password" className="input" autoComplete="new-password" placeholder="Yeni şifre (en az 10 karakter)" aria-label="Yeni şifre" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
      <Button type="submit" variant="secondary" busy={busy} disabled={!current || next.length < 10}>Şifreyi değiştir</Button>
    </form>
  );
}
