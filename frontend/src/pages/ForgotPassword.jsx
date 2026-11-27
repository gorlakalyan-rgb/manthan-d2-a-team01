import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, KeyRound, Mail, MailCheck } from 'lucide-react';
import { post } from '../api.js';
import { useDocumentTitle } from '../hooks.js';
import { FieldError } from '../components/ui.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

export default function ForgotPassword() {
  useDocumentTitle('Forgot password');
  const [email, setEmail] = useState(() => { try { return JSON.parse(localStorage.getItem('ef.lastLogin') || '{}').email || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { setError('Enter the email address you sign in with.'); document.getElementById('fp-email')?.focus(); return; }
    setError('');
    setBusy(true);
    try {
      setSent({ email: em, ...(await post('/api/auth/forgot', { email: em })) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout skipTo="forgot-form">
      <Link to="/login" className="small auth-link row" style={{ gap: 6, width: 'fit-content', marginBottom: 18 }}><ArrowLeft size={15} aria-hidden="true" /> Back to sign in</Link>
      {!sent ? (
        <>
          <span className="auth-badge"><KeyRound aria-hidden="true" /></span>
          <div className="eyebrow">Account recovery</div>
          <h2>Forgot your password?</h2>
          <p className="muted">Enter your work email. We'll send a secure link to set a new password. The link works once and expires in 15 minutes.</p>
          <form id="forgot-form" onSubmit={submit} noValidate className="stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="fp-email">Work email</label>
              <div className="input-icon">
                <Mail aria-hidden="true" />
                <input id="fp-email" className="input" type="email" autoComplete="username" inputMode="email" value={email} placeholder="you@company.com" autoFocus
                  onChange={(e) => { setEmail(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'fp-err' : undefined} />
              </div>
              <FieldError id="fp-err">{error}</FieldError>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Sending…' : <>Send reset link <ArrowRight aria-hidden="true" /></>}
            </button>
          </form>
        </>
      ) : (
        <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <span className="auth-badge ok"><MailCheck aria-hidden="true" /></span>
          <div className="eyebrow">Check your inbox</div>
          <h2>Reset link requested</h2>
          <p className="muted">If an account exists for <b style={{ color: 'var(--color-text)' }}>{sent.email}</b>, a reset link is on its way. It expires in 15 minutes and can be used once.</p>
          {sent.reset_url && (
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              <div className="alert-body small">
                <strong>Demo mode:</strong> this environment has no mail server, so the link is shown here instead of being emailed.
                <div style={{ marginTop: 10 }}><Link className="btn btn-primary btn-sm" to={sent.reset_url}>Open reset link <ArrowRight aria-hidden="true" /></Link></div>
              </div>
            </div>
          )}
          <div className="row" style={{ marginTop: 20 }}>
            <button type="button" className="btn" onClick={() => setSent(null)}>Use a different email</button>
            <Link to="/login" className="btn btn-ghost">Back to sign in</Link>
          </div>
        </motion.div>
      )}
    </AuthLayout>
  );
}
