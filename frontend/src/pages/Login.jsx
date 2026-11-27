import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, Landmark, Lock, Mail, Receipt, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useDocumentTitle } from '../hooks.js';
import { FieldError } from '../components/ui.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

export const ROLES = [
  { id: 'employee', label: 'Employee', hint: 'File and track claims', icon: Receipt },
  { id: 'manager', label: 'Manager', hint: 'Approve your team', icon: Users },
  { id: 'auditor', label: 'Finance auditor', hint: 'Audits and samples', icon: ShieldCheck },
  { id: 'head', label: 'Finance head', hint: 'Payouts and policy', icon: Landmark },
];
const LAST = 'ef.lastLogin';   // remembers email + role only, never the password

function RolePicker({ value, onChange, error }) {
  const refs = useRef([]);
  const move = (e, i) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = (i + d + ROLES.length) % ROLES.length;
    onChange(ROLES[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="field">
      <span className="label" id="role-label">Sign in as</span>
      <div className="role-grid" role="radiogroup" aria-labelledby="role-label" aria-describedby={error ? 'role-err' : undefined} aria-invalid={!!error}>
        {ROLES.map((r, i) => {
          const on = value === r.id;
          return (
            <button key={r.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} aria-label={r.label}
              tabIndex={(value ? on : i === 0) ? 0 : -1}
              className={`role-tile ${on ? 'on' : ''}`} onClick={() => onChange(r.id)} onKeyDown={(e) => move(e, i)}>
              <span className="role-ico"><r.icon aria-hidden="true" /></span>
              <span className="role-txt"><b>{r.label}</b><span aria-hidden="true">{r.hint}</span></span>
              <AnimatePresence>{on && <motion.span className="role-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check aria-hidden="true" /></motion.span>}</AnimatePresence>
            </button>
          );
        })}
      </div>
      <FieldError id="role-err">{error}</FieldError>
    </div>
  );
}

export default function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { return {}; } })();
  const [email, setEmail] = useState(saved.email || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(saved.role || '');
  const [remember, setRemember] = useState(!!saved.email);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);
  const pwRef = useRef(null);

  useEffect(() => { (saved.email ? pwRef : emailRef).current?.focus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    const em = email.trim();
    if (!em) errs.email = 'Enter your work email.';
    else if (!/^\S+@\S+\.\S+$/.test(em)) errs.email = 'That does not look like an email address.';
    if (!password) errs.password = 'Enter your password.';
    if (!role) errs.role = 'Choose the role you are signing in as.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      document.getElementById(errs.email ? 'email' : errs.password ? 'password' : 'role-label')?.focus?.();
      return;
    }
    setBusy(true);
    try {
      await login(em, password, role);
      try {
        if (remember) localStorage.setItem(LAST, JSON.stringify({ email: em, role }));
        else localStorage.removeItem(LAST);
      } catch { /* storage unavailable */ }
    } catch (err) {
      if (err.code === 'ROLE_MISMATCH') setFormError({ title: 'Wrong role for this account.', body: 'Your email and password are correct, but this account is not registered for the role you picked. Choose your actual role and try again.' });
      else if (err.status === 401) setFormError({ title: 'Could not sign in.', body: 'Email or password is incorrect.' });
      else setFormError({ title: 'Could not sign in.', body: err.message });
    } finally {
      setBusy(false);
    }
  };

  const onPwKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'));

  return (
    <AuthLayout skipTo="login-form">
      <div className="eyebrow">Welcome back</div>
      <h2>Sign in to ExpenseFlow</h2>
      <p className="muted">Use your work email, password and the role you work in.</p>

      <AnimatePresence>
        {formError && (
          <motion.div role="alert" className="alert alert-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <AlertTriangle size={18} color="var(--color-danger)" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
            <div className="alert-body"><strong>{formError.title}</strong> {formError.body}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <form id="login-form" onSubmit={submit} noValidate className="stack" style={{ marginTop: 20 }}>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <div className="input-icon">
            <Mail aria-hidden="true" />
            <input id="email" ref={emailRef} className="input" type="email" autoComplete="username" inputMode="email" value={email} placeholder="you@company.com"
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
          </div>
          <FieldError id="email-err">{errors.email}</FieldError>
        </div>

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" className="small auth-link">Forgot password?</Link>
          </div>
          <div className="input-icon" style={{ position: 'relative' }}>
            <Lock aria-hidden="true" />
            <input id="password" ref={pwRef} className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
              onKeyUp={onPwKey} onKeyDown={onPwKey} onBlur={() => setCaps(false)}
              aria-invalid={!!errors.password} aria-describedby={[errors.password && 'pw-err', caps && 'caps-hint'].filter(Boolean).join(' ') || undefined}
              style={{ paddingRight: 44 }} />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label="Reveal characters" aria-pressed={show} title={show ? 'Hide' : 'Show'}
              style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38 }}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {caps && <span id="caps-hint" className="small" style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Caps Lock is on.</span>}
          <FieldError id="pw-err">{errors.password}</FieldError>
        </div>

        <RolePicker value={role} onChange={(r) => { setRole(r); setErrors((x) => ({ ...x, role: undefined })); setFormError(null); }} error={errors.role} />

        <label className="row small" style={{ gap: 10, cursor: 'pointer', width: 'fit-content' }} title="Saves your work address and role on this device, never your password">
          <input type="checkbox" className="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me on this device
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <><span className="spinner" aria-hidden="true" style={{ borderTopColor: 'currentColor' }} /> Signing in…</> : <>Sign in <ArrowRight aria-hidden="true" /></>}
        </button>
      </form>

      <p className="auth-foot small">
        <span><ShieldCheck size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Role-based access. Each role sees only its own work. Sessions end after 8 hours.</span>
      </p>
    </AuthLayout>
  );
}
