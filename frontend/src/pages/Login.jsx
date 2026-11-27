import { useRef, useState } from 'react';
import { asList, get, humanize } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, FieldError } from '../components/ui.jsx';

const ROLE_ORDER = { employee: 0, manager: 1, auditor: 2, head: 3 };
const ROLE_HINT = {
  employee: 'Files claims',
  manager: 'Approves team claims',
  auditor: 'Reviews high-value and sampled claims',
  head: 'Final approval, payouts, policy',
};

export default function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);
  const demo = useAsync(() => get('/api/demo-users'), []);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!email.trim()) errs.email = 'Enter your work email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'That does not look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setFormError(err.status === 401 || err.status === 400 ? 'Email or password is incorrect. Demo users use the password demo123.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (u) => {
    setEmail(u.email);
    setPassword('demo123');
    setErrors({});
    setFormError(null);
    pwRef.current?.focus();
  };

  const users = [...asList(demo.data, 'users')].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

  return (
    <div className="login-wrap">
      <a className="skip-link" href="#login-form">Skip to sign-in form</a>
      <div className="login-grid">
        <main className="card" style={{ margin: 0 }} id="main">
          <div className="brand" style={{ marginBottom: 8 }}>
            <span className="brand-mark" aria-hidden="true">₹</span><span>ExpenseFlow</span>
          </div>
          <h1>Sign in</h1>
          <p className="muted">File expenses, approve claims and run payouts in one place.</p>
          {formError && <div role="alert" className="alert alert-error"><div className="alert-body"><strong>Could not sign in.</strong> {formError}</div></div>}
          <form id="login-form" onSubmit={submit} noValidate className="stack">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
              <FieldError id="email-err">{errors.email}</FieldError>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" ref={pwRef} className="input" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined} />
              <FieldError id="pw-err">{errors.password}</FieldError>
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </main>
        <section className="card" style={{ margin: 0 }} aria-labelledby="demo-h">
          <h2 id="demo-h">Demo users</h2>
          <p className="muted small">Pick a user to fill the form. Every demo user’s password is <strong>demo123</strong>. All data is synthetic.</p>
          {demo.loading && <p role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> Loading demo users…</p>}
          {demo.error && <ErrorState error={demo.error} onRetry={demo.reload} title="Could not load demo users" />}
          {!demo.loading && !demo.error && users.length === 0 && <p className="muted">No demo users are available. You can still sign in with an email and password.</p>}
          {users.length > 0 && (
            <ul className="demo-list">
              {users.map((u) => (
                <li key={u.email}>
                  <button type="button" className="btn demo-btn" onClick={() => pick(u)} aria-pressed={email === u.email}>
                    <span className="who"><span>{u.name}</span><span>{u.email}</span></span>
                    <span className="chip chip-info" title={ROLE_HINT[u.role]}>{humanize(u.role)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
