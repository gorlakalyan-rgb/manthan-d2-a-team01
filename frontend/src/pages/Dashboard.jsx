import { useState } from 'react';
import { categoryLabel, formatMoney, formatMoneyShort, get, ruleShort } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView } from '../components/ui.jsx';
import BarChart from '../components/BarChart.jsx';

const VALUE_KEYS = ['total_paise', 'spend_paise', 'amount_paise', 'value', 'count'];

/** Normalise [{label-ish, value-ish}] or {label: value} into [{label, value}]. */
function series(raw, labelKeys, labelFn = (x) => x, valueKeys = VALUE_KEYS) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, v]) => ({ __label: k, __value: typeof v === 'object' ? v : v }));
  return arr.map((r) => {
    if ('__label' in r) {
      const v = typeof r.__value === 'object' && r.__value ? valueKeys.map((k) => r.__value[k]).find((x) => x != null) : r.__value;
      return { label: labelFn(r.__label), value: Number(v) || 0 };
    }
    const lk = labelKeys.find((k) => r[k] != null);
    const vk = valueKeys.find((k) => r[k] != null);
    return { label: labelFn(String(lk ? r[lk] : '—')), value: Number(vk ? r[vk] : 0) || 0 };
  });
}

function monthShort(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function hours(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return '—';
  if (n >= 48) return `${(n / 24).toFixed(1)} days`;
  return `${n.toFixed(1)} h`;
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const [months, setMonths] = useState(6);
  const state = useAsync(() => get('/api/dashboard', { months }), [months]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">Spend, approvals and policy violations across the company.</p>
        </div>
        <div className="field" style={{ minWidth: 180 }}>
          <label htmlFor="months">Period</label>
          <select id="months" className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        </div>
      </div>
      <DataView state={state} loadingLabel="Loading dashboard…">
        {(d) => {
          const k = d.kpis || {};
          const byCat = series(d.by_category, ['category', 'name', 'label'], categoryLabel).sort((a, b) => b.value - a.value);
          const byDept = series(d.by_department, ['department', 'name', 'label']).sort((a, b) => b.value - a.value);
          const byMonth = series(d.by_month, ['month', 'period', 'label']).map((x) => ({ ...x, short: monthShort(x.label) }));
          const byRule = series(d.violations_by_rule, ['rule', 'code', 'rule_code', 'label'], ruleShort, ['count', 'value', 'violations']).sort((a, b) => b.value - a.value);
          const tiles = [
            ['Total spend', formatMoneyShort(k.total_spend_paise)],
            ['Claims', Number(k.claims ?? 0).toLocaleString('en-IN')],
            ['Pending approval', Number(k.pending ?? 0).toLocaleString('en-IN')],
            ['Avg approval time', hours(k.avg_approval_hours)],
            ['Policy violations', Number(k.violation_count ?? 0).toLocaleString('en-IN')],
            ['Oldest pending', hours(k.oldest_pending_hours)],
          ];
          return (
            <>
              <section aria-label="Key figures" className="kpis">
                {tiles.map(([label, value]) => (
                  <div className="kpi" key={label}>
                    <div className="kpi-label">{label}</div>
                    <div className="kpi-value">{value}</div>
                  </div>
                ))}
              </section>
              <div className="charts">
                <BarChart title="Spend by category" data={byCat} format={formatMoneyShort} unitLabel="Spend" />
                <BarChart title="Spend by department" data={byDept} format={formatMoneyShort} unitLabel="Spend" />
                <BarChart title="Spend by month" data={byMonth} format={formatMoneyShort} orientation="vertical" unitLabel="Spend" />
                <BarChart title="Policy violations by rule" data={byRule} format={(v) => v.toLocaleString('en-IN')} color="var(--chart-2)" unitLabel="Violations" />
              </div>
            </>
          );
        }}
      </DataView>
    </>
  );
}
