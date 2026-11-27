import { motion } from 'motion/react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { AppIcon, Wordmark } from './brand.jsx';

const ease = [0.2, 0.8, 0.2, 1];

/** Split-screen frame shared by sign-in, forgot-password and reset-password. */
export default function AuthLayout({ children, skipTo = 'auth-form' }) {
  return (
    <div className="auth">
      <a className="skip-link" href={`#${skipTo}`}>Skip to form</a>
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
          <div className="auth-mobile-brand" aria-hidden="true"><AppIcon size={34} /><Wordmark /></div>
          {children}
        </motion.main>
      </section>
    </div>
  );
}
