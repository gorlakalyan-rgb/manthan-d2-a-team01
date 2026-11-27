import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { asList, get, humanize } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, FieldError } from '../components/ui.jsx';
import { AppIcon, Avatar, Wordmark } from '../components/brand.jsx';

const ROLE_ORDER = { employee: 0, manager: 1, auditor: 2, head: 3 };
const ROLE_HINT = {
  employee: 'Files claims',
  manager: 'Approves team claims',
  auditor: 'High-value & sample audits',
  head: 'Final approval, payouts, policy',
};
const ease = [0.2, 0.8, 0.2, 1];

export default function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);
  const demo = useAsync(() => get('/api/demo-users'), []);

  const doLogin = async (em, pw) => {
    setBusy(true);
    try {
      await login(em, pw);
    } catch (err) {
      setFormError(err.status === 401 || err.status === 400 ? 'Email or password is incorrect. Demo users use the password demo123.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!email.trim()) errs.email = 'Enter your work email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'That does not look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    await doLogin(email.trim(), password);
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
    <div className="auth">
      <a className="skip-link" href="#login-form">Skip to sign-in form</a>
      <section className="auth-hero" aria-label="About ExpenseFlow">
        <div className="orbit" aria-hidden="true" />
        <div className="row" style={{ gap: 12, position: 'relative', zIndex: 1 }}>
          <AppIcon size={40} />
          <span className="sb-brand" style={{ padding: 0, minHeight: 0 }}><Wordmark /></span>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            Every rupee, <em>accounted</em> for.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease }}>
            File claims in seconds. A live policy engine checks every line, routes it to the right approver and keeps an append-only audit trail all the way to payout.
          </motion.p>
          <div className="icon-stage">
            <AppIcon size={210} tilt glow />
            <motion.div className="float-card" style={{ left: '4%', top: '14%' }} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6, ease }}>
              <CheckCircle2 size={20} color="var(--color-success)" /><div><b>Auto-approved</b><span className="muted">Meals · ₹1,240</span></div>
            </motion.div>
            <motion.div className="float-card" style={{ right: '2%', bottom: '10%' }} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8, ease }}>
              <ShieldCheck size={20} color="var(--accent)" /><div><b>Every action logged</b><span className="muted">Append-only audit trail</span></div>
            </motion.div>
          </div>
        </div>

        <div className="hero-stats" style={{ position: 'relative', zIndex: 1 }}>
          <div><b>3-step</b>approval chain</div>
          <div><b>8</b>policy rules live</div>
          <div><b>IST</b>native, ₹ lakh format</div>
        </div>
      </section>

      <section className="auth-panel">
        <motion.main className="auth-card" id="main" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease }}>
          <div className="eyebrow">Welcome back</div>
          <h2>Sign in to ExpenseFlow</h2>
          <p className="muted">Use your work email, or choose a demo persona below.</p>

          {formError && <div role="alert" className="alert alert-error"><div className="alert-body"><strong>Could not sign in.</strong> {formError}</div></div>}

          <form id="login-form" onSubmit={submit} noValidate className="stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <div className="input-icon">
                <Mail aria-hidden="true" />
                <input id="email" className="input" type="email" autoComplete="username" value={email} placeholder="you@company.com"
                  onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
              </div>
              <FieldError id="email-err">{errors.email}</FieldError>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-icon" style={{ position: 'relative' }}>
                <Lock aria-hidden="true" />
                <input id="password" ref={pwRef} className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined} style={{ paddingRight: 44 }} />
                <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label="Reveal characters" aria-pressed={show} title={show ? 'Hide' : 'Show'}
                  style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38 }}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <FieldError id="pw-err">{errors.password}</FieldError>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <><span className="spinner" aria-hidden="true" style={{ borderTopColor: 'currentColor' }} /> Signing in…</> : <>Sign in <ArrowRight aria-hidden="true" /></>}
            </button>
          </form>

          <div className="or">Demo personas</div>
          {demo.loading && <p role="status" aria-live="polite" className="muted small"><span className="spinner" aria-hidden="true" /> Loading demo users…</p>}
          {demo.error && <ErrorState error={demo.error} onRetry={demo.reload} title="Could not load demo users" />}
          {users.length > 0 && (
            <div className="persona-grid" role="list">
              {users.map((u, i) => (
                <motion.button key={u.email} role="listitem" type="button" className="persona" aria-pressed={email === u.email}
                  onClick={() => pick(u)} onDoubleClick={() => doLogin(u.email, 'demo123')} title={`${ROLE_HINT[u.role] || ''} · double-click to sign in`}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06, ease }}>
                  <Avatar name={u.name} size={36} />
                  <span className="who"><b>{u.name}</b><span>{humanize(u.role)} · {u.department}</span></span>
                </motion.button>
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 16 }}>
            <Sparkles size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--accent)' }} /> Password for every demo user is <strong>demo123</strong>. Double-click a persona to sign straight in. All data is synthetic.
          </p>
        </motion.main>
      </section>
    </div>
  );
}
