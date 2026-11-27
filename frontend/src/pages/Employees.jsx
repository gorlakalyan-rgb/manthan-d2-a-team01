import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Building2, ChevronLeft, ChevronRight, Columns3, Download, LayoutGrid,
  Landmark, Mail, Network, Rows3, Search, ShieldAlert, UserCheck, UserRound, Users, Wallet, X,
} from 'lucide-react';
import { asList, categoryLabel, formatDate, formatMoney, formatMoneyShort, get, humanize, ruleShort } from '../api.js';
import { roleCaps, useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView, EmptyState, ErrorState, Loading, StatusChip } from '../components/ui.jsx';
import { Avatar } from '../components/brand.jsx';
import { AreaChart, Count, Donut, HBars, Money, Ring } from '../components/charts.jsx';

const ease = [0.2, 0.8, 0.2, 1];
const PAGE = 25;
const ROLE_TONE = { head: 'chip-purple', auditor: 'chip-info', manager: 'chip-brand', employee: 'chip-neutral' };

function inrCompact(paise) {
  const r = (Number(paise) || 0) / 100;
  const f = (n, d) => n.toLocaleString('en-IN', { maximumFractionDigits: d });
  if (r >= 1e7) return `₹${f(r / 1e7, 2)} Cr`;
  if (r >= 1e5) return `₹${f(r / 1e5, 1)} L`;
  if (r >= 1e3) return `₹${f(r / 1e3, 1)} K`;
  return `₹${f(r, 0)}`;
}
const flagRate = (e) => (e.claims ? e.flagged_claims / e.claims : 0);
function risk(e) {
  const r = flagRate(e);
  if (e.claims >= 3 && (r >= 0.5 || e.rejected_claims >= 3)) return { label: 'High', tone: 'chip-danger', level: 2 };
  if (e.claims >= 2 && r >= 0.3) return { label: 'Watch', tone: 'chip-warning', level: 1 };
  return { label: 'Low', tone: 'chip-success', level: 0 };
}
function ago(iso) {
  if (!iso) return 'Never';
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}
function monthInfo(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return { short: ym, full: ym };
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return { short: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), full: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

const COLUMNS = [
  { id: 'name', label: 'Employee', sort: (e) => e.name.toLowerCase(), always: true },
  { id: 'role', label: 'Role', sort: (e) => e.role },
  { id: 'department', label: 'Department', sort: (e) => e.department },
  { id: 'manager', label: 'Manager', sort: (e) => e.manager_name || '' },
  { id: 'claims', label: 'Claims', sort: (e) => e.claims, num: true },
  { id: 'approved', label: 'Approved spend', sort: (e) => Number(e.approved_paise), num: true },
  { id: 'pending', label: 'Pending', sort: (e) => Number(e.pending_paise), num: true },
  { id: 'risk', label: 'Policy risk', sort: (e) => flagRate(e) },
  { id: 'last', label: 'Last claim', sort: (e) => (e.last_claim_at ? new Date(e.last_claim_at).getTime() : 0) },
  { id: 'bank', label: 'Bank', sort: (e) => e.ifsc || '', bank: true },
];

/* ------------------------------------------------------------------ detail drawer */
function EmployeeDrawer({ id, onClose, onOpen, canBank }) {
  const state = useAsync(() => (id ? get(`/api/employees/${id}`) : Promise.resolve(null)), [id]);
  const [tab, setTab] = useState('overview');
  useEffect(() => { setTab('overview'); }, [id]);
  useEffect(() => {
    if (!id) return undefined;
    const k = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open], .cmdk')) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [id, onClose]);

  const d = state.data;
  const e = d?.employee;
  const months = (d?.by_month || []).map((m) => ({ label: m.label, value: Number(m.value), ...monthInfo(m.label) }));
  const cats = (d?.by_category || []).map((c) => ({ label: categoryLabel(c.label), value: Number(c.value) }));
  const catDonut = [...cats.slice(0, 5), ...(cats.length > 5 ? [{ label: 'Others', value: cats.slice(5).reduce((s, x) => s + x.value, 0) }] : [])];
  const flags = (d?.flags || []).map((f) => ({ label: ruleShort(f.label), value: f.value }));
  const approvalRate = e && e.claims ? (e.claims - e.rejected_claims - e.pending_claims) / e.claims : 0;

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside className="sheet emp-sheet" role="dialog" aria-modal="true" aria-label="Employee details"
            initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            <button type="button" className="icon-btn emp-close" onClick={onClose} aria-label="Close employee details" autoFocus><X /></button>
            {!d && !state.error && <div style={{ padding: '64px 20px 20px' }}><Loading label="Loading employee…" /></div>}
            {state.error && <div style={{ padding: '64px 20px 20px' }}><ErrorState error={state.error} onRetry={state.reload} title="Could not load this employee" /></div>}
            {e && (
              <div className="sheet-body" style={{ padding: '0 20px 20px' }}>
                <div className="emp-cover" aria-hidden="true" />
                <div className="emp-head">
                  <Avatar name={e.name} className="lg" />
                  <div style={{ minWidth: 0, paddingTop: 44 }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.5rem', margin: 0 }}>{e.name}</h2>
                    <div className="row small muted" style={{ gap: 8 }}>
                      <span className={`chip ${ROLE_TONE[e.role]}`}>{humanize(e.role)}</span>
                      <span className="row" style={{ gap: 4 }}><Building2 size={14} aria-hidden="true" />{e.department}</span>
                      <span className={`chip chip-plain ${risk(e).tone}`}>{risk(e).label} risk</span>
                    </div>
                  </div>
                </div>
                <div className="row small" style={{ gap: 14, margin: '10px 0 14px' }}>
                  <a href={`mailto:${e.email}`} className="row" style={{ gap: 6 }}><Mail size={14} aria-hidden="true" />{e.email}</a>
                  {canBank && e.ifsc && <span className="row muted" style={{ gap: 6 }}><Landmark size={14} aria-hidden="true" /><span className="mono">{e.account_masked} · {e.ifsc}</span></span>}
                  {e.delegation_active && <span className="chip chip-purple">Delegation active</span>}
                </div>

                {/* Reporting chain */}
                <nav aria-label="Reporting line" className="emp-chain">
                  {[...(d.manager_chain || [])].reverse().map((m) => (
                    <button key={m.id} type="button" className="emp-chain-node" onClick={() => onOpen(m.id)}>
                      <Avatar name={m.name} size={22} /><span>{m.name}</span>
                    </button>
                  ))}
                  <span className="emp-chain-node current"><Avatar name={e.name} size={22} /><span>{e.name}</span></span>
                </nav>

                <div className="segmented" role="tablist" aria-label="Employee sections" style={{ margin: '14px 0' }}>
                  {[['overview', 'Overview'], ['claims', `Claims (${d.recent_claims.length})`], ['team', `Team (${d.direct_reports.length})`]].map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
                      {tab === k && <motion.span layoutId="emp-tab" className="seg-pill" />}{l}
                    </button>
                  ))}
                </div>

                {tab === 'overview' && (
                  <div className="stack">
                    <div className="stat-grid">
                      <div className="stat"><span>Claims</span><b><Count value={e.claims} /></b></div>
                      <div className="stat"><span>Approved</span><b><Money paise={e.approved_paise} /></b></div>
                      <div className="stat"><span>Paid out</span><b style={{ color: 'var(--color-success)' }}><Money paise={e.paid_paise} /></b></div>
                      <div className="stat"><span>Pending</span><b><Money paise={e.pending_paise} /></b></div>
                    </div>
                    <div className="row" style={{ gap: 16, padding: 14, borderRadius: 14, background: 'var(--color-surface-2)' }}>
                      <Ring value={approvalRate} size={60} stroke={7}>{Math.round(approvalRate * 100)}%</Ring>
                      <div style={{ flex: 1 }}><b className="small">Approval rate</b><div className="small muted">{e.rejected_claims} rejected · {e.pending_claims} in progress</div></div>
                      <Ring value={flagRate(e)} size={60} stroke={7} color={flagRate(e) > 0.5 ? 'var(--color-danger)' : 'var(--accent)'}>{Math.round(flagRate(e) * 100)}%</Ring>
                      <div style={{ flex: 1 }}><b className="small">Flagged</b><div className="small muted">{e.flagged_claims} of {e.claims} claims</div></div>
                    </div>
                    <section>
                      <h3 className="small" style={{ textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-muted)' }}>Approved spend · last 12 months</h3>
                      {months.length ? <AreaChart data={months} height={200} format={(v) => inrCompact(v)} /> : <p className="small muted">No approved spend yet.</p>}
                    </section>
                    <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
                      <section>
                        <h3 className="small" style={{ textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-muted)' }}>By category</h3>
                        {catDonut.length ? <Donut data={catDonut} size={180} format={(v) => inrCompact(v)} /> : <p className="small muted">No data.</p>}
                      </section>
                      <section>
                        <h3 className="small" style={{ textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-muted)' }}>Policy flags</h3>
                        {flags.length ? <HBars data={flags} format={(v) => v} accentFirst /> : <p className="small muted" style={{ display: 'flex', gap: 6 }}><UserCheck size={16} /> No policy flags. Clean record.</p>}
                      </section>
                    </div>
                  </div>
                )}

                {tab === 'claims' && (
                  <ul className="emp-list">
                    {d.recent_claims.length === 0 && <li className="muted small">No claims submitted.</li>}
                    {d.recent_claims.map((c, i) => (
                      <motion.li key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                        <Link to={`/claims/${c.id}`} className="emp-row">
                          <span style={{ minWidth: 0 }}><b className="small">#{c.id} · {c.title}</b><span className="cell-sub">{formatDate(c.submitted_at)} · {c.line_count} line{c.line_count === 1 ? '' : 's'}{c.flags?.length ? ` · ${c.flags.map(ruleShort).join(', ')}` : ''}</span></span>
                          <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}><span className="mono small">{formatMoney(c.total_paise)}</span><StatusChip status={c.status} step={c.current_step} /></span>
                        </Link>
                      </motion.li>
                    ))}
                  </ul>
                )}

                {tab === 'team' && (
                  <ul className="emp-list">
                    {d.direct_reports.length === 0 && <li className="muted small">{e.name.split(' ')[0]} has no direct reports.</li>}
                    {d.direct_reports.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="emp-row" onClick={() => onOpen(r.id)}>
                          <span className="row" style={{ gap: 10 }}><Avatar name={r.name} size={30} /><span><b className="small">{r.name}</b><span className="cell-sub">{humanize(r.role)} · {r.department}</span></span></span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ org view */
function OrgView({ rows, onOpen }) {
  const byDept = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.department)) m.set(r.department, []); m.get(r.department).push(r); });
    return [...m.entries()].sort().map(([dept, list]) => {
      const leaders = list.filter((r) => r.direct_reports > 0).sort((a, b) => b.direct_reports - a.direct_reports);
      const reportsOf = (lid) => list.filter((r) => r.manager_id === lid);
      const orphans = list.filter((r) => !r.direct_reports && !(r.manager_id && ids.has(r.manager_id) && list.some((l) => l.id === r.manager_id)));
      return { dept, list, leaders, reportsOf, orphans, spend: list.reduce((s, r) => s + Number(r.approved_paise), 0) };
    });
  }, [rows]);
  return (
    <div className="stack">
      {byDept.map((g, gi) => (
        <motion.section key={g.dept} className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.05, ease }}>
          <div className="card-title">
            <div className="row" style={{ gap: 10 }}><span className="kpi-icon"><Building2 aria-hidden="true" /></span><div><h2 style={{ margin: 0, fontSize: '1rem' }}>{g.dept}</h2><span className="sub">{g.list.length} people · {inrCompact(g.spend)} approved</span></div></div>
          </div>
          <div className="org-grid">
            {g.leaders.map((l) => (
              <div key={l.id} className="org-team">
                <button type="button" className="org-lead" onClick={() => onOpen(l.id)}>
                  <Avatar name={l.name} size={36} />
                  <span><b className="small">{l.name}</b><span className="cell-sub">{humanize(l.role)} · {l.direct_reports} reports</span></span>
                </button>
                <div className="org-members">
                  {g.reportsOf(l.id).map((r) => (
                    <button key={r.id} type="button" className="org-member" onClick={() => onOpen(r.id)} title={`${r.name} · ${humanize(r.role)}`}>
                      <Avatar name={r.name} size={26} /><span>{r.name}</span>{risk(r).level > 0 && <i className={`org-dot ${risk(r).level === 2 ? 'hi' : ''}`} aria-label={`${risk(r).label} risk`} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {g.orphans.length > 0 && (
              <div className="org-team">
                <div className="org-lead" style={{ cursor: 'default' }}><span className="kpi-icon"><Users aria-hidden="true" /></span><span><b className="small">Reports outside this department</b><span className="cell-sub">{g.orphans.length} people</span></span></div>
                <div className="org-members">
                  {g.orphans.map((r) => (
                    <button key={r.id} type="button" className="org-member" onClick={() => onOpen(r.id)}><Avatar name={r.name} size={26} /><span>{r.name}</span></button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function Employees() {
  useDocumentTitle('Employees');
  const { user } = useAuth();
  const caps = roleCaps(user);
  const canBank = caps.isAuditor;
  const state = useAsync(() => get('/api/employees'), []);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('all');
  const [riskF, setRiskF] = useState('all');
  const [activity, setActivity] = useState('all');
  const [sort, setSort] = useState({ id: 'approved', dir: 'desc' });
  const [view, setView] = useState('table');
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState(() => new Set(canBank ? [] : ['bank']));
  const [colMenu, setColMenu] = useState(false);
  const openId = params.get('id');
  const open = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('id', id); else n.delete('id'); return n; });

  const all = useMemo(() => asList(state.data), [state.data]);
  const depts = useMemo(() => [...new Set(all.map((e) => e.department))].sort(), [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.id === sort.id) || COLUMNS[0];
    return all.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (role !== 'all' && e.role !== role) return false;
      if (riskF !== 'all' && risk(e).label.toLowerCase() !== riskF) return false;
      if (activity === 'pending' && !e.pending_claims) return false;
      if (activity === 'inactive' && e.last_claim_at && (Date.now() - new Date(e.last_claim_at)) / 86400000 < 60) return false;
      if (activity === 'managers' && !e.direct_reports) return false;
      if (!needle) return true;
      return `${e.name} ${e.email} ${e.department} ${e.manager_name || ''} ${e.role}`.toLowerCase().includes(needle);
    }).sort((a, b) => {
      const x = col.sort(a); const y = col.sort(b);
      const r = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? r : -r;
    });
  }, [all, q, dept, role, riskF, activity, sort]);
  useEffect(() => { setPage(0); }, [q, dept, role, riskF, activity, sort]);

  const maxSpend = Math.max(1, ...all.map((e) => Number(e.approved_paise)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const totals = {
    people: all.length,
    active: all.filter((e) => e.claims > 0).length,
    approved: all.reduce((s, e) => s + Number(e.approved_paise), 0),
    pending: all.reduce((s, e) => s + Number(e.pending_paise), 0),
    highRisk: all.filter((e) => risk(e).level === 2).length,
  };
  const cols = COLUMNS.filter((c) => !hidden.has(c.id) && (!c.bank || canBank));
  const toggleSort = (id) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: id === 'name' || id === 'department' || id === 'manager' || id === 'role' ? 'asc' : 'desc' }));
  const anyFilter = q || dept || role !== 'all' || riskF !== 'all' || activity !== 'all';

  const exportCsv = () => {
    const head = ['ID', 'Name', 'Email', 'Role', 'Department', 'Manager', 'Direct reports', 'Claims', 'Approved (INR)', 'Paid (INR)', 'Pending (INR)', 'Rejected', 'Flagged', 'Risk', 'Last claim', ...(canBank ? ['Account', 'IFSC'] : [])];
    const lines = rows.map((e) => [e.id, e.name, e.email, e.role, e.department, e.manager_name || '', e.direct_reports, e.claims,
      (e.approved_paise / 100).toFixed(2), (e.paid_paise / 100).toFixed(2), (e.pending_paise / 100).toFixed(2), e.rejected_claims, e.flagged_claims, risk(e).label,
      e.last_claim_at ? e.last_claim_at.slice(0, 10) : '', ...(canBank ? [e.account_masked, e.ifsc] : [])]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `expenseflow-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const cell = (e, c) => {
    switch (c.id) {
      case 'name': return (
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <Avatar name={e.name} size={34} />
          <span style={{ minWidth: 0 }}><b className="small" style={{ display: 'block' }}>{e.name}</b><span className="cell-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{e.email}</span></span>
        </span>);
      case 'role': return <span className={`chip ${ROLE_TONE[e.role]}`}>{humanize(e.role)}{e.direct_reports ? ` · ${e.direct_reports}` : ''}</span>;
      case 'department': return e.department;
      case 'manager': return e.manager_name ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}><Avatar name={e.manager_name} size={22} />{e.manager_name}</span> : <span className="muted">—</span>;
      case 'claims': return <span>{e.claims}</span>;
      case 'approved': return (
        <span style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
          <span>{formatMoneyShort(e.approved_paise)}</span>
          <span className="bar-track" style={{ width: 90, height: 5 }}><span className="bar-fill" style={{ display: 'block', width: `${(Number(e.approved_paise) / maxSpend) * 100}%` }} /></span>
        </span>);
      case 'pending': return e.pending_claims ? <span>{formatMoneyShort(e.pending_paise)}<span className="cell-sub">{e.pending_claims} claim{e.pending_claims === 1 ? '' : 's'}</span></span> : <span className="muted">—</span>;
      case 'risk': { const r = risk(e); return <span className={`chip ${r.tone}`} title={`${e.flagged_claims} of ${e.claims} claims flagged, ${e.rejected_claims} rejected`}>{r.label} · {Math.round(flagRate(e) * 100)}%</span>; }
      case 'last': return <span title={e.last_claim_at ? formatDate(e.last_claim_at) : ''}>{ago(e.last_claim_at)}</span>;
      case 'bank': return e.ifsc ? <span className="mono small">{e.account_masked}<span className="cell-sub">{e.ifsc}</span></span> : '—';
      default: return null;
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">People</div>
          <h1>Employee details</h1>
          <p className="page-sub">{caps.isAuditor ? 'Everyone in the company' : 'Everyone in your reporting line'}, with their claims, spend, policy record and reporting line. Click a person for the full profile.</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!rows.length}><Download aria-hidden="true" /> Export CSV</button>
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[[Users, 'People', <Count value={totals.people} />, `${depts.length} department${depts.length === 1 ? '' : 's'}`],
          [UserRound, 'Active claimants', <Count value={totals.active} />, `${totals.people ? Math.round((totals.active / totals.people) * 100) : 0}% have filed claims`],
          [Wallet, 'Approved spend', <Money paise={totals.approved} />, 'Approved, in payout and paid'],
          [AlertTriangle, 'Pending', <Money paise={totals.pending} />, 'Awaiting a decision'],
          [ShieldAlert, 'High policy risk', <Count value={totals.highRisk} />, 'Half or more claims flagged'],
        ].map(([Icon, label, value, foot], i) => (
          <motion.div key={label} className="kpi" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={label === 'High policy risk' ? () => setRiskF('high') : undefined} style={{ cursor: label === 'High policy risk' ? 'pointer' : undefined }}>
            <div className="kpi-head"><span className="kpi-label">{label}</span><span className="kpi-icon"><Icon aria-hidden="true" /></span></div>
            <div className="kpi-value" style={{ fontSize: '1.5rem' }}>{value}</div>
            <div className="kpi-foot">{foot}</div>
          </motion.div>
        ))}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="input-icon" style={{ flex: '1 1 260px' }}>
            <Search aria-hidden="true" />
            <input className="input" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search name, email, department or manager" aria-label="Search employees" />
          </div>
          <select className="input" style={{ width: 190 }} value={dept} onChange={(ev) => setDept(ev.target.value)} aria-label="Department">
            <option value="">All departments</option>{depts.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className="input" style={{ width: 150 }} value={riskF} onChange={(ev) => setRiskF(ev.target.value)} aria-label="Policy risk">
            <option value="all">Any risk</option><option value="high">High risk</option><option value="watch">Watch</option><option value="low">Low risk</option>
          </select>
          <select className="input" style={{ width: 170 }} value={activity} onChange={(ev) => setActivity(ev.target.value)} aria-label="Activity">
            <option value="all">Any activity</option><option value="pending">Has pending claims</option><option value="inactive">No claim in 60 days</option><option value="managers">People managers</option>
          </select>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="segmented" role="group" aria-label="Role">
            {['all', 'employee', 'manager', 'auditor', 'head'].map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>
                {role === r && <motion.span layoutId="emp-role" className="seg-pill" />}{r === 'all' ? 'All roles' : `${humanize(r)}s`}
              </button>
            ))}
          </div>
          {anyFilter && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setDept(''); setRole('all'); setRiskF('all'); setActivity('all'); }}><X aria-hidden="true" /> Clear filters</button>}
          <span className="grow" />
          <span className="small muted" aria-live="polite">{rows.length} of {all.length} people</span>
          {view === 'table' && (
            <div style={{ position: 'relative' }}>
              <button type="button" className="btn btn-sm" aria-haspopup="true" aria-expanded={colMenu} onClick={() => setColMenu((o) => !o)}><Columns3 aria-hidden="true" /> Columns</button>
              {colMenu && (
                <div className="menu" role="group" aria-label="Visible columns" onMouseLeave={() => setColMenu(false)}>
                  {COLUMNS.filter((c) => !c.always && (!c.bank || canBank)).map((c) => (
                    <label key={c.id} className="menu-item" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" className="checkbox" checked={!hidden.has(c.id)}
                        onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="segmented" role="group" aria-label="View">
            {[['table', Rows3, 'Table'], ['cards', LayoutGrid, 'Cards'], ['org', Network, 'Org chart']].map(([k, Icon, l]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} title={l}>
                {view === k && <motion.span layoutId="emp-view" className="seg-pill" />}<Icon aria-hidden="true" /><span className="emp-view-label">{l}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <DataView state={state} loadingLabel="Loading employees…" isEmpty={() => rows.length === 0}
        empty={<EmptyState icon={<Users />} title={all.length ? 'No one matches these filters' : 'No employees to show'}>{all.length ? 'Try clearing a filter or a different search.' : 'There is no one in your reporting line yet.'}</EmptyState>}>
        {() => (
          <>
            {view === 'table' && (
              <div className="table-wrap">
                <table className="data responsive emp-table">
                  <caption className="visually-hidden">Employees, sorted by {COLUMNS.find((c) => c.id === sort.id)?.label} {sort.dir === 'asc' ? 'ascending' : 'descending'}</caption>
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c.id} scope="col" className={c.num ? 'num' : ''} aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                          <button type="button" className="th-sort" onClick={() => toggleSort(c.id)}>
                            {c.label}{sort.id === c.id ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} tabIndex={0} className={String(e.id) === openId ? 'selected' : undefined} style={{ cursor: 'pointer' }}
                        onClick={() => open(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(e.id); } }}
                        aria-label={`Open ${e.name}`}>
                        {cols.map((c) => <td key={c.id} data-label={c.label} className={c.num ? 'num' : ''}>{cell(e, c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {view === 'cards' && (
              <div className="emp-cards">
                {shown.map((e, i) => {
                  const r = risk(e);
                  return (
                    <motion.button key={e.id} type="button" className="card card-hover emp-card" onClick={() => open(e.id)}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03, ease }}>
                      <span className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                        <Avatar name={e.name} size={46} />
                        <span style={{ minWidth: 0, textAlign: 'left' }}><b style={{ display: 'block' }}>{e.name}</b><span className="cell-sub">{e.department}{e.manager_name ? ` · reports to ${e.manager_name}` : ''}</span></span>
                      </span>
                      <span className="row" style={{ gap: 6, margin: '12px 0' }}>
                        <span className={`chip ${ROLE_TONE[e.role]}`}>{humanize(e.role)}</span>
                        <span className={`chip chip-plain ${r.tone}`}>{r.label} risk</span>
                        {e.pending_claims > 0 && <span className="chip chip-info chip-plain">{e.pending_claims} pending</span>}
                      </span>
                      <span className="emp-card-stats">
                        <span><b>{e.claims}</b>claims</span>
                        <span><b>{inrCompact(e.approved_paise)}</b>approved</span>
                        <span><b>{Math.round(flagRate(e) * 100)}%</b>flagged</span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {view === 'org' && <OrgView rows={rows} onOpen={open} />}

            {view !== 'org' && pages > 1 && (
              <nav className="row" aria-label="Pagination" style={{ justifyContent: 'space-between', marginTop: 16 }}>
                <span className="small muted">Showing {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
                <span className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft aria-hidden="true" /></button>
                  {Array.from({ length: pages }).map((_, i) => (
                    <button key={i} type="button" className={`btn btn-sm ${i === page ? 'btn-primary' : ''}`} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>{i + 1}</button>
                  ))}
                  <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight aria-hidden="true" /></button>
                </span>
              </nav>
            )}
          </>
        )}
      </DataView>

      <EmployeeDrawer id={openId} onClose={() => open(null)} onOpen={open} canBank={canBank} />
    </>
  );
}
