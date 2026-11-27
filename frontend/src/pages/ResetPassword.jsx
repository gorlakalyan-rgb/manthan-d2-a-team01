import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Check, Eye, EyeOff, KeyRound, Lock, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { get, post } from '../api.js';
import { useDocumentTitle } from '../hooks.js';
import { FieldError, Loading } from '../components/ui.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

const RULES = [
  ['At least 8 characters', (p) => p.length >= 8],
  ['Contains a letter', (p) => /[A-Za-z]/.test(p)],
  ['Contains a number', (p) => /\d/.test(p)],
];
function strength(p) {
  let s = RULES.filter(([, f]) => f(p)).length;
  if (p.length >= 12) s += 1;
  if (/[^A-Za-z0-9]/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p)) s += 1;
  return Math.min(4, Math.max(0, s - 1));
}
const LEVELS = [['Too weak', 'var(--color-danger)'], ['Weak', 'var(--color-danger)'], ['Fair', 'var(--accent)'], ['Good', 'var(--color-success)'], ['Strong', 'var(--color-success)']];

export default function ResetPassword() {
  useDocumentTitle('Set a new password');
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [check, setCheck] = useState({ loading: true });
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setCheck({ error: 'This page needs the link from your reset email.' }); return; }
    get('/api/auth/reset', { token }).then((d) => setCheck(d)).catch((e) => setCheck({ error: e.message }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!RULES.every(([, f]) => f(pw))) errs.pw = 'Your new password does not meet the rules below.';
    if (pw2 !== pw) errs.pw2 = 'The two passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await post('/api/auth/reset', { token, password: pw });
      setDone(true);
    } catch (err) {
      if (err.code === 'WEAK_PASSWORD') setErrors({ pw: err.message });
      else setCheck({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  const lvl = strength(pw);
  return (
    <AuthLayout skipTo="reset-form">
      {check.loading && <Loading label="Checking your reset link…" rows={1} />}
      {check.error && (
        <div role="alert">
          <span className="auth-badge bad"><ShieldAlert aria-hidden="true" /></span>
          <div className="eyebrow">Account recovery</div>
          <h2>Link not usable</h2>
          <p className="muted">{check.error}</p>
          <div className="row" style={{ marginTop: 16 }}>
            <Link to="/forgot-password" className="btn btn-primary">Request a new link</Link>
            <Link to="/login" className="btn btn-ghost">Back to sign in</Link>
          </div>
        </div>
      )}
      {check.valid && done && (
        <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <span className="auth-badge ok"><ShieldCheck aria-hidden="true" /></span>
          <div className="eyebrow">All set</div>
          <h2>Password updated</h2>
          <p className="muted">Your new password is active and the reset link can't be used again. Sign in with it now.</p>
          <a href="/login" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 16 }}>Go to sign in <ArrowRight aria-hidden="true" /></a>
        </motion.div>
      )}
      {check.valid && !done && (
        <>
          <span className="auth-badge"><KeyRound aria-hidden="true" /></span>
          <div className="eyebrow">Account recovery</div>
          <h2>Set a new password</h2>
          <p className="muted">For <b style={{ color: 'var(--color-text)' }}>{check.email_hint}</b>. Choose something you don't use anywhere else.</p>
          <form id="reset-form" onSubmit={submit} noValidate className="stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="new-pw">New password</label>
              <div className="input-icon" style={{ position: 'relative' }}>
                <Lock aria-hidden="true" />
                <input id="new-pw" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} autoFocus style={{ paddingRight: 44 }}
                  onChange={(e) => { setPw(e.target.value); setErrors({}); }} aria-invalid={!!errors.pw} aria-describedby="pw-rules pw-meter" />
                <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label="Reveal characters" aria-pressed={show}
                  style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38 }}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div id="pw-meter" className="pw-meter" aria-live="polite">
                <div className="pw-bars" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ background: pw && i < Math.max(1, lvl) ? LEVELS[lvl][1] : undefined }} />)}</div>
                <span className="small" style={{ color: pw ? LEVELS[lvl][1] : 'var(--color-text-faint)' }}>{pw ? LEVELS[lvl][0] : 'Strength'}</span>
              </div>
              <ul id="pw-rules" className="pw-rules">
                {RULES.map(([t, f]) => { const ok = f(pw); return <li key={t} className={ok ? 'ok' : ''}>{ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{t}<span className="visually-hidden">{ok ? ' (met)' : ' (not met)'}</span></li>; })}
              </ul>
              <FieldError id="pw-err">{errors.pw}</FieldError>
            </div>
            <div className="field">
              <label htmlFor="new-pw2">Confirm new password</label>
              <div className="input-icon">
                <Lock aria-hidden="true" />
                <input id="new-pw2" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2}
                  onChange={(e) => { setPw2(e.target.value); setErrors({}); }} aria-invalid={!!errors.pw2} aria-describedby={errors.pw2 ? 'pw2-err' : undefined} />
              </div>
              <FieldError id="pw2-err">{errors.pw2}</FieldError>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : <>Update password <ArrowRight aria-hidden="true" /></>}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
