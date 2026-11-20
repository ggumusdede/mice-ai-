import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { Button, InlineError, TextInput } from '../components/ui';
import { errorMessage } from '../api/client';

export function LoginPage() {
  const t = useT();
  const { login, status } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err) || t.login.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} noValidate>
        <img src="/icon.svg" alt="" width={64} height={64} className="login__logo" />
        <h1 className="login__title">{t.app.short}</h1>
        <p className="login__sub">{t.login.subtitle}</p>
        <TextInput label={t.login.email} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <TextInput label={t.login.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <InlineError message={error} />
        <Button type="submit" size="lg" busy={busy} className="btn--block">
          {t.login.submit}
        </Button>
        <button
          type="button"
          className="login__hint"
          onClick={() => {
            setEmail('admin@demo.test');
            setPassword('demo1234');
          }}
        >
          {t.login.demoHint}
        </button>
      </form>
    </div>
  );
}
