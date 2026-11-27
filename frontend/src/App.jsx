import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Compass, Lock } from 'lucide-react';
import { roleCaps, useAuth } from './auth.jsx';
import Shell from './components/Shell.jsx';
import { AppIcon } from './components/brand.jsx';
import Login from './pages/Login.jsx';
import MyClaims from './pages/MyClaims.jsx';
import ClaimEditor from './pages/ClaimEditor.jsx';
import ClaimDetail from './pages/ClaimDetail.jsx';
import Inbox from './pages/Inbox.jsx';
import Review from './pages/Review.jsx';
import Delegations from './pages/Delegations.jsx';
import AuditQueue from './pages/AuditQueue.jsx';
import Payouts from './pages/Payouts.jsx';
import Policy from './pages/Policy.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Profile from './pages/Profile.jsx';
import SettingsPage from './pages/Settings.jsx';
import Activity from './pages/Activity.jsx';

function homeFor(user) {
  const caps = roleCaps(user);
  let pref = 'auto';
  try { pref = JSON.parse(localStorage.getItem('ef.settings') || '{}').startPage || 'auto'; } catch { /* ignore */ }
  if (pref === '/claims') return pref;
  if (pref === '/approvals' && caps.isApprover) return pref;
  if (pref === '/dashboard' && caps.isAuditor) return pref;
  if (caps.isAuditor) return '/dashboard';
  if (caps.isApprover) return '/approvals';
  return '/claims';
}

function Guard({ allow, children }) {
  const { user } = useAuth();
  if (allow && !allow(roleCaps(user), user)) {
    return (
      <div className="card state" role="alert">
        <span className="state-icon"><Lock /></span>
        <h1>Not available for your role</h1>
        <p>This page is for {allow.label || 'other roles'}. Use the sidebar to find your work.</p>
        <NavLink className="btn btn-primary" to="/">Go to my home</NavLink>
      </div>
    );
  }
  return children;
}

const approverOnly = Object.assign((c) => c.isApprover, { label: 'approvers' });
const auditorOnly = Object.assign((c) => c.isAuditor, { label: 'finance auditors and the finance head' });
const headOnly = Object.assign((c) => c.isHead, { label: 'the finance head' });

export default function App() {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div className="login-wrap" role="status" aria-live="polite">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ display: 'grid', justifyItems: 'center', gap: 16 }}>
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}><AppIcon size={72} glow /></motion.div>
          <span className="muted small">Checking your session…</span>
        </motion.div>
      </div>
    );
  }
  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <Login />;
  }

  return (
    <Shell>
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}>
      <Routes location={location}>
        <Route path="/" element={<Navigate to={homeFor(user)} replace />} />
        <Route path="/login" element={<Navigate to={location.state?.from || homeFor(user)} replace />} />
        <Route path="/claims" element={<MyClaims />} />
        <Route path="/claims/new" element={<ClaimEditor />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        <Route path="/claims/:id/edit" element={<ClaimEditor />} />
        <Route path="/approvals" element={<Guard allow={approverOnly}><Inbox /></Guard>} />
        <Route path="/approvals/:id" element={<Review />} />
        <Route path="/delegations" element={<Guard allow={approverOnly}><Delegations /></Guard>} />
        <Route path="/audit" element={<Guard allow={auditorOnly}><AuditQueue /></Guard>} />
        <Route path="/dashboard" element={<Guard allow={auditorOnly}><Dashboard /></Guard>} />
        <Route path="/payouts" element={<Guard allow={headOnly}><Payouts /></Guard>} />
        <Route path="/policy" element={<Policy />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/activity" element={<Guard allow={auditorOnly}><Activity /></Guard>} />
        <Route path="*" element={
          <div className="card state"><span className="state-icon"><Compass /></span><h1>Page not found</h1><p>That page does not exist or has moved.</p><NavLink className="btn btn-primary" to="/">Go home</NavLink></div>
        } />
      </Routes>
      </motion.div>
      </AnimatePresence>
    </Shell>
  );
}
