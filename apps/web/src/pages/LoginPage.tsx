import { useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'react-router-dom';
import { api, setSignedInEmail } from '../api/client';
import { useEntrance } from '../lib/anim';
import { useProject } from '../state/ProjectContext';

/** Where the SPA gate sent us from, so a successful sign-in returns there. */
export type LoginLocationState = { from?: { pathname: string; search?: string } } | undefined;

const DEFAULT_LANDING = '/projects';

/**
 * DX-auth: email/password → POST /auth/login → Sanctum PAT.
 * Rendered outside the app shell (no TopNav); `RequireAuth` in App.tsx sends
 * unauthenticated visitors here. Once `token` is set the page redirects itself.
 */
const LoginPage: React.FC = () => {
  const ref = useEntrance();
  const { token, setToken } = useProject();
  const location = useLocation<LoginLocationState>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from;
  const target = from && from.pathname !== '/login' ? `${from.pathname}${from.search ?? ''}` : DEFAULT_LANDING;

  if (token) return <Redirect to={target} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.login({ email: email.trim(), password });
      setSignedInEmail(data.user.email);
      setToken(data.token); // re-render → <Redirect> above
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setBusy(false);
    }
  };

  return (
    <div className="login" ref={ref}>
      <form className="panel login__card" onSubmit={(e) => void submit(e)} data-animate noValidate>
        <span className="topnav__brand login__brand">
          maintain<span className="topnav__brand-dot" aria-hidden="true" />
        </span>
        <h1 className="login__title">Sign in</h1>
        <p className="page__subtitle login__subtitle">Use your LSS account to reach the maintenance dashboard.</p>

        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        {error && (
          <p role="alert" className="login__error">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--accent login__submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="field__hint login__hint">
          Running the desktop launcher? It signs you in automatically — no password needed.
        </p>
      </form>
    </div>
  );
};

export default LoginPage;
