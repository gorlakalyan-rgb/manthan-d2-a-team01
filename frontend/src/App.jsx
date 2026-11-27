import { useEffect, useRef } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { roleCaps, useAuth } from './auth.jsx';
import { Loading } from './components/ui.jsx';
import { humanize } from './api.js';
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

function homeFor(user) {
  const caps = roleCaps(user);
  if (caps.isAuditor) return '/dashboard';
  if (caps.isApprover) return '/approvals';
  return '/claims';
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const caps = roleCaps(user);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);
  const first = useRef(true);

  // Move focus to main content on route change so screen-reader users hear the new page.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const links = [
    { to: '/claims', label: 'My claims', show: true },
    { to: '/approvals', label: 'Approvals', show: caps.isApprover },
    { to: '/audit', label: 'Audit queue', show: caps.isAuditor },
    { to: '/dashboard', label: 'Dashboard', show: caps.isAuditor },
    { to: '/payouts', label: 'Payouts', show: caps.isHead },
    { to: '/delegations', label: 'Delegation', show: caps.canDelegate },
    { to: '/policy', label: 'Policy', show: true },
  ].filter((l) => l.show);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="app-header">
        <div className="header-inner">
          <NavLink to={homeFor(user)} className="brand" aria-label="ExpenseFlow home">
            <span className="brand-mark" aria-hidden="true">₹</span>
            <span>ExpenseFlow</span>
          </NavLink>
          <div className="header-user">
            <div className="user-meta">
              <span className="user-name">{user.name}</span>
              <span className="user-role">{humanize(user.role)}{user.department ? ` · ${user.department}` : ''}</span>
            </div>
            <button type="button" className="btn btn-sm" onClick={onLogout}>Log out</button>
          </div>
        </div>
        <nav className="main-nav" aria-label="Main">
          <ul>
            {links.map((l) => (
              <li key={l.to}><NavLink to={l.to}>{l.label}</NavLink></li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} ref={mainRef}>
        <p className="visually-hidden">Signed in as {user.name}, {humanize(user.role)}</p>
        {children}
      </main>
    </>
  );
}

function Guard({ allow, children }) {
  const { user } = useAuth();
  if (allow && !allow(roleCaps(user), user)) {
    return (
      <div className="card state" role="alert">
        <h1>Not available for your role</h1>
        <p>This page is for {allow.label || 'other roles'}. Use the menu above to find your work.</p>
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
    return <div className="login-wrap"><Loading label="Checking your session…" rows={0} /></div>;
  }
  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <Login />;
  }

  return (
    <Shell>
      <Routes>
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
        <Route path="*" element={
          <div className="card state"><h1>Page not found</h1><p>That page does not exist.</p><NavLink className="btn btn-primary" to="/">Go home</NavLink></div>
        } />
      </Routes>
    </Shell>
  );
}
