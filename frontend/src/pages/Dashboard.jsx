import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, Download, Hourglass, Inbox, Lightbulb, ShieldAlert, Wallet } from 'lucide-react';
import { categoryLabel, formatMoneyShort, get, ruleShort } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { AreaChart, ChartCard, Columns, Count, Donut, HBars, Money, Ring, Sparkline } from '../components/charts.jsx';

const ease = [0.2, 0.8, 0.2, 1];

/** Indian compact money: ₹2.45 Cr, ₹64.9 L, ₹9.8 K. */
export function inrCompact(paise, axis = false) {
  const r = (Number(paise) || 0) / 100;
  const f = (n, d) => n.toLocaleString('en-IN', { maximumFractionDigits: d });
  if (r >= 1e7) return `₹${f(r / 1e7, axis ? 1 : 2)} Cr`;
  if (r >= 1e5) return `₹${f(r / 1e5, 1)} L`;
  if (r >= 1e3) return `₹${f(r / 1e3, axis ? 0 : 1)} K`;
  return `₹${f(r, 0)}`;
}

function monthInfo(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return { short: ym, full: ym };
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return {
    short: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
    full: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

const norm = (arr = []) => (Array.isArray(arr) ? arr : Object.entries(arr).map(([label, value]) => ({ label, value })))
  .map((r) => ({ label: String(r.label ?? r.name ?? r.category ?? r.department ?? r.rule ?? '—'), value: Number(r.value ?? r.total_paise ?? r.count ?? 0) || 0 }));

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({ icon: Icon, label, children, foot, hero = false, i = 0, to }) {
  const body = (
    <>
      <div className="kpi-head"><span className="kpi-label">{label}</span><span className="kpi-icon"><Icon aria-hidden="true" /></span></div>
      <div className="kpi-value">{children}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </>
  );
  return (
    <motion.div className={`kpi ${hero ? 'hero' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.4, ease }}>
      {to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>{body}</Link> : body}
    </motion.div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="kpis">{Array.from({ length: 5 }).map((_, i) => <div key={i} className={`kpi ${i === 0 ? 'hero' : ''}`}><div className="skeleton" style={{ width: '50%' }} /><div className="skeleton" style={{ height: 30, width: '70%' }} /><div className="skeleton" style={{ width: '40%' }} /></div>)}</div>
      <div className="charts"><div className="card c-8 skeleton-block skeleton" style={{ height: 320 }} /><div className="card c-4 skeleton-block skeleton" style={{ height: 320 }} /></div>
    </div>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [months, setMonths] = useState(6);
  const state = useAsync(() => get('/api/dashboard', { months }), [months]);
  const d = state.data;

  const exportCsv = () => {
    if (!d) return;
    const rows = [['Section', 'Label', 'Value']];
    norm(d.by_month).forEach((r) => rows.push(['Spend by month', r.label, (r.value / 100).toFixed(2)]));
    norm(d.by_category).forEach((r) => rows.push(['Spend by category', categoryLabel(r.label), (r.value / 100).toFixed(2)]));
    norm(d.by_department).forEach((r) => rows.push(['Spend by department', r.label, (r.value / 100).toFixed(2)]));
    norm(d.violations_by_rule).forEach((r) => rows.push(['Violations by rule', ruleShort(r.label), r.value]));
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `expenseflow-dashboard-${months}m.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Finance overview</div>
          <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="page-sub">Spend, approvals and policy health across the company. All amounts in ₹, times in IST.</p>
        </div>
        <div className="row">
          <div className="segmented" role="group" aria-label="Period">
            {[3, 6, 12].map((m) => (
              <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>
                {months === m && <motion.span layoutId="period-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                {m === 12 ? '12 months' : `${m} months`}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!d}><Download aria-hidden="true" /> Export</button>
        </div>
      </div>

      {state.error && !d && <ErrorState error={state.error} onRetry={state.reload} title="Could not load the dashboard" />}
      {!d && !state.error && <Skeleton />}
      {d && <DashboardBody d={d} months={months} navigate={navigate} />}
    </>
  );
}

function DashboardBody({ d, months, navigate }) {
  const k = d.kpis || {};
  const byMonth = norm(d.by_month).map((x) => ({ ...x, ...monthInfo(x.label) }));
  const byCat = norm(d.by_category).sort((a, b) => b.value - a.value).map((x) => ({ ...x, code: x.label, label: categoryLabel(x.label) }));
  const byDept = norm(d.by_department).sort((a, b) => b.value - a.value);
  const byRule = norm(d.violations_by_rule).sort((a, b) => b.value - a.value).map((x) => ({ ...x, code: x.label, label: ruleShort(x.label) }));

  // Month-over-month change uses the last two complete points.
  const last = byMonth[byMonth.length - 1]?.value || 0;
  const prev = byMonth[byMonth.length - 2]?.value || 0;
  const peak = byMonth.reduce((m, x) => (x.value > m.value ? x : m), byMonth[0] || { value: 0 });
  const mom = prev ? ((last - prev) / prev) * 100 : 0;
  const catTop = byCat[0]; const catTotal = byCat.reduce((s, x) => s + x.value, 0) || 1;
  const violationRate = k.claims ? (k.violation_count / k.claims) * 100 : 0;
  const slaFrac = Math.min(1, (Number(k.oldest_pending_hours) || 0) / 48);
  const catDonut = [...byCat.slice(0, 5), ...(byCat.length > 5 ? [{ label: 'Others', value: byCat.slice(5).reduce((s, x) => s + x.value, 0) }] : [])];
  const range = byMonth.length ? `${byMonth[0].full} – ${byMonth[byMonth.length - 1].full}` : `Last ${months} months`;

  const insights = [
    catTop && { icon: Wallet, text: <><b>{catTop.label}</b> is {Math.round((catTop.value / catTotal) * 100)}% of approved spend.</> },
    byDept[0] && { icon: ArrowUpRight, text: <><b>{byDept[0].label}</b> spends the most at {inrCompact(byDept[0].value)}.</> },
    byRule[0] && { icon: ShieldAlert, text: <><b>{byRule[0].label}</b> is the most-broken rule ({byRule[0].value.toLocaleString('en-IN')} claims).</> },
    peak?.full && { icon: Lightbulb, text: <>Peak month was <b>{peak.full}</b> at {inrCompact(peak.value)}.</> },
  ].filter(Boolean);

  return (
    <>
      <div className="kpis">
        <Kpi hero icon={Wallet} label="Approved spend" i={0}
          foot={<><span><Count value={k.claims} /> claims filed</span>{prev > 0 && <span className="delta" title={`${byMonth[byMonth.length - 1]?.full} (month to date) vs ${byMonth[byMonth.length - 2]?.full}`}>{mom >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(mom).toFixed(1)}% {byMonth[byMonth.length - 1]?.short} MTD vs {byMonth[byMonth.length - 2]?.short}</span>}</>}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Money paise={k.total_spend_paise} />
            <span style={{ color: 'var(--accent)' }}><Sparkline values={byMonth.map((x) => x.value)} color="var(--accent)" width={120} height={40} /></span>
          </div>
        </Kpi>
        <Kpi icon={Inbox} label="Pending approval" i={1} to="/audit" foot={<span>Across all steps</span>}><Count value={k.pending} /></Kpi>
        <Kpi icon={Clock3} label="Avg approval time" i={2} foot={<span className={`delta ${k.avg_approval_hours > 48 ? 'down' : 'up'}`}>{k.avg_approval_hours > 48 ? 'Over' : 'Within'} 48 h SLA</span>}>
          <Count value={k.avg_approval_hours} decimals={1} suffix=" h" />
        </Kpi>
        <Kpi icon={AlertTriangle} label="Policy violations" i={3} to="/audit" foot={<span>{violationRate.toFixed(1)}% of claims flagged</span>}><Count value={k.violation_count} /></Kpi>
        <Kpi icon={Hourglass} label="Oldest pending" i={4} foot={<span>SLA 48 h</span>}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><Count value={k.oldest_pending_hours} decimals={1} suffix=" h" /></span>
            <Ring value={slaFrac} size={46} stroke={6} color={slaFrac > 0.85 ? 'var(--color-danger)' : slaFrac > 0.6 ? 'var(--accent)' : 'var(--color-success)'}>{Math.round(slaFrac * 100)}%</Ring>
          </div>
        </Kpi>
      </div>

      <div className="charts">
        <ChartCard className="c-8" title="Spend trend" sub={range}
          table={{ head: ['Month', 'Spend'], rows: byMonth.map((x) => [x.full, formatMoneyShort(x.value)]) }}>
          <AreaChart data={byMonth} format={(v, axis) => inrCompact(v, axis)} />
        </ChartCard>
        <ChartCard className="c-4" title="Spend by category" sub="Approved, in payout and paid"
          table={{ head: ['Category', 'Spend', 'Share'], rows: byCat.map((x) => [x.label, formatMoneyShort(x.value), `${Math.round((x.value / catTotal) * 100)}%`]) }}>
          <Donut data={catDonut} format={(v) => inrCompact(v)} centerLabel="Total" />
        </ChartCard>

        <ChartCard className="c-6" title="Spend by department" sub="Click a department to open its queue"
          table={{ head: ['Department', 'Spend'], rows: byDept.map((x) => [x.label, formatMoneyShort(x.value)]) }}>
          <div onClick={(e) => { const row = e.target.closest('.bar-row'); if (row) navigate(`/audit?department=${encodeURIComponent(row.firstChild.textContent)}`); }} style={{ cursor: 'pointer' }}>
            <HBars data={byDept} format={(v) => inrCompact(v)} accentFirst />
          </div>
        </ChartCard>
        <ChartCard className="c-6" title="Violations by rule" sub="Claims flagged per policy rule · click to drill in"
          table={{ head: ['Rule', 'Claims'], rows: byRule.map((x) => [x.label, x.value.toLocaleString('en-IN')]) }}>
          <div onClick={(e) => { const i = [...e.currentTarget.querySelectorAll('.bar-row')].indexOf(e.target.closest('.bar-row')); if (i >= 0) navigate(`/audit?flag=${byRule[i].code}`); }} style={{ cursor: 'pointer' }}>
            <HBars data={byRule} format={(v) => v.toLocaleString('en-IN')} accentFirst />
          </div>
        </ChartCard>

        <ChartCard className="c-8" title="Monthly volume" sub="Approved spend per month">
          <Columns data={byMonth} format={(v) => inrCompact(v, true)} height={220} />
        </ChartCard>
        <section className="card c-4" aria-labelledby="ins-h" style={{ margin: 0 }}>
          <div className="card-title"><div><h2 id="ins-h" style={{ fontSize: '1rem' }}>Smart insights</h2><div className="sub">Generated from this period’s data</div></div></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {insights.map((x, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08 }}
                style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 14, background: 'var(--color-surface-2)', fontSize: '0.85rem', alignItems: 'flex-start' }}>
                <span className="kpi-icon" style={{ flex: 'none' }}><x.icon aria-hidden="true" /></span><span>{x.text}</span>
              </motion.li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
