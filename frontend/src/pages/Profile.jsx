import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { BadgeCheck, Building2, Check, FilePlus2, Mail, Settings, ShieldCheck, UserCog, X } from 'lucide-react';
import { asList, formatDate, formatMoney, get, humanize } from '../api.js';
import { roleCaps, useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { Avatar } from '../components/brand.jsx';
import { Money, Ring } from '../components/charts.jsx';
import { StatusChip } from '../components/ui.jsx';

const ease = [0.2, 0.8, 0.2, 1];

const PERMS = [
  ['File and track expense claims', () => true],
  ['Approve claims from direct reports', (c) => c.isApprover],
  ['Delegate approvals while away', (c) => c.canDelegate],
  ['Work the audit queue and sample audits', (c) => c.isAuditor],
  ['View company dashboard and audit trail', (c) => c.isAuditor],
  ['Create payout batches and mark paid', (c) => c.isHead],
  ['Publish policy changes', (c) => c.isHead],
];

function Pattern() {
  return (
    <svg className="pattern" aria-hidden="true">
      <defs>
        <pattern id="pp" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
          <path d="M0 22 H44 M22 0 V44" stroke="#fff" strokeWidth="1" />
          <circle cx="22" cy="22" r="3" fill="#fff" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#pp)" />
    </svg>
  );
}

export default function Profile() {
  useDocumentTitle('Profile');
  const { user } = useAuth();
  const caps = roleCaps(user);
  const claims = useAsync(() => get('/api/claims'), []);
  const dele = useAsync(() => (caps.canDelegate ? get('/api/delegations') : Promise.resolve([])), [caps.canDelegate]);
  const list = asList(claims.data);
  const sum = (f) => list.filter(f).reduce((s, c) => s + (Number(c.total_paise) || 0), 0);
  const paid = sum((c) => c.status === 'PAID');
  const pending = sum((c) => ['PENDING_APPROVAL', 'SAMPLE_AUDIT', 'APPROVED', 'IN_PAYOUT'].includes(c.status));
  const total = sum((c) => c.status !== 'DRAFT');
  const approved = list.filter((c) => ['APPROVED', 'IN_PAYOUT', 'PAID'].includes(c.status)).length;
  const decided = list.filter((c) => ['APPROVED', 'IN_PAYOUT', 'PAID', 'REJECTED', 'AUTO_REJECTED'].includes(c.status)).length;
  const rate = decided ? approved / decided : 0;
  const activeDel = asList(dele.data).filter((x) => x.active !== false);

  return (
    <>
      <motion.div className="profile-cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}><Pattern /></motion.div>
      <div className="profile-head">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}>
          <Avatar name={user.name} className="xl" />
        </motion.div>
        <div style={{ paddingBottom: 6, flex: 1, minWidth: 220 }}>
          <h1>{user.name} <BadgeCheck size={22} color="var(--color-primary)" aria-label="Verified employee" style={{ verticalAlign: 'middle' }} /></h1>
          <div className="row muted small">
            <span className="chip chip-brand">{humanize(user.role)}</span>
            <span className="row" style={{ gap: 4 }}><Building2 size={14} aria-hidden="true" /> {user.department || '—'}</span>
            <span className="row" style={{ gap: 4 }}><Mail size={14} aria-hidden="true" /> {user.email}</span>
          </div>
        </div>
        <div className="row" style={{ paddingBottom: 6 }}>
          <Link to="/settings" className="btn"><Settings aria-hidden="true" /> Settings</Link>
          <Link to="/claims/new" className="btn btn-primary"><FilePlus2 aria-hidden="true" /> New claim</Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="money-h">
          <div className="card-title"><h2 id="money-h">My money</h2><span className="sub">From your own claims</span></div>
          <div className="stat-grid">
            <div className="stat"><span>Total claimed</span><b><Money paise={total} /></b></div>
            <div className="stat"><span>Reimbursed</span><b style={{ color: 'var(--color-success)' }}><Money paise={paid} /></b></div>
            <div className="stat"><span>On its way</span><b><Money paise={pending} /></b></div>
          </div>
          <div className="row" style={{ marginTop: 20, gap: 16 }}>
            <Ring value={rate} size={72} stroke={8}>{Math.round(rate * 100)}%</Ring>
            <div><b>Approval rate</b><div className="small muted">{approved} of {decided} decided claims were approved.</div></div>
          </div>
        </section>

        <section className="card" aria-labelledby="route-h">
          <div className="card-title"><h2 id="route-h">How your claims are approved</h2></div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {[
              ['Policy engine', 'Checks every line instantly against 8 rules', 'Always'],
              ['Line manager', user.manager_id ? `Your reporting manager (#${user.manager_id})` : 'No manager on record', 'Flagged or above ₹25,000'],
              ['Finance auditor', 'High-value review', 'Claims above ₹25,000'],
              ['Finance head', 'Final sign-off', 'Claims above ₹1,00,000'],
            ].map(([t, s, w], i) => (
              <motion.li key={t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.07, ease }}
                style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="route-dot" style={{ borderColor: i === 0 ? 'var(--accent)' : undefined, color: i === 0 ? 'var(--accent)' : undefined }}>{i + 1}</span>
                <div style={{ flex: 1 }}><b className="small">{t}</b><div className="small muted">{s}</div><span className="chip chip-neutral chip-plain" style={{ marginTop: 4 }}>{w}</span></div>
              </motion.li>
            ))}
          </ol>
        </section>

        <section className="card" aria-labelledby="perm-h">
          <div className="card-title"><h2 id="perm-h">Access & permissions</h2><ShieldCheck size={18} color="var(--color-primary)" aria-hidden="true" /></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {PERMS.map(([t, f]) => {
              const ok = f(caps);
              return (
                <li key={t} className="row" style={{ padding: '8px 0', borderBottom: '1px dashed var(--color-border)', gap: 10, opacity: ok ? 1 : 0.55 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', background: ok ? 'var(--color-success-soft)' : 'var(--color-surface-3)', color: ok ? 'var(--color-success)' : 'var(--color-text-faint)' }}>
                    {ok ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <span className="small">{t}</span>
                  <span className="visually-hidden">{ok ? 'allowed' : 'not allowed'}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card" aria-labelledby="recent-h">
          <div className="card-title"><h2 id="recent-h">Recent claims</h2><Link to="/claims" className="small">View all</Link></div>
          {list.length === 0 && <p className="muted small">No claims yet. <Link to="/claims/new">File your first claim</Link>.</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {list.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link to={`/claims/${c.id}`} className="row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit', padding: 10, borderRadius: 12, background: 'var(--color-surface-2)' }}>
                  <span style={{ minWidth: 0 }}><b className="small">#{c.id} · {c.title}</b><span className="cell-sub">{formatDate(c.submitted_at || c.created_at)}</span></span>
                  <span className="row"><span className="mono small">{formatMoney(c.total_paise)}</span><StatusChip status={c.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
          {caps.canDelegate && (
            <div className="alert alert-info" style={{ marginTop: 16, marginBottom: 0 }}>
              <UserCog size={18} aria-hidden="true" />
              <div className="alert-body small">{activeDel.length ? `${activeDel.length} active delegation${activeDel.length > 1 ? 's' : ''}.` : 'No delegation set.'} <Link to="/delegations">Manage delegation</Link></div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
