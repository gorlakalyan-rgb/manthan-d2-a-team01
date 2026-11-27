import { useId, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { BarChart3, Table2 } from 'lucide-react';

const EASE = [0.2, 0.8, 0.2, 1];
const inr0 = { style: 'currency', currency: 'INR', maximumFractionDigits: 0 };

/** Rolling ₹ amount (paise in). */
export function Money({ paise, compact = false }) {
  const rupees = Math.round((Number(paise) || 0) / 100);
  const fmt = compact && rupees >= 1e5 ? { ...inr0, notation: 'compact', maximumFractionDigits: 2 } : inr0;
  return <NumberFlow value={rupees} locales="en-IN" format={fmt} />;
}
export function Count({ value, suffix, decimals = 0 }) {
  return <NumberFlow value={Number(value) || 0} locales="en-IN" format={{ maximumFractionDigits: decimals, minimumFractionDigits: decimals }} suffix={suffix} />;
}

/** Smooth path through points using Catmull-Rom → cubic Bézier. */
function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Card wrapper with "view as table" toggle for accessibility. */
export function ChartCard({ title, sub, table, children, className = '', action }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className}`} aria-label={title}>
      <div className="card-title">
        <div>
          <h2 style={{ fontSize: '1rem' }}>{title}</h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="row">
          {action}
          {table && (
            <div className="segmented" role="group" aria-label={`${title} view`}>
              <button type="button" aria-pressed={!asTable} onClick={() => setAsTable(false)} title="Chart"><BarChart3 aria-hidden="true" /><span className="visually-hidden">Chart</span></button>
              <button type="button" aria-pressed={asTable} onClick={() => setAsTable(true)} title="Table"><Table2 aria-hidden="true" /><span className="visually-hidden">Table</span></button>
            </div>
          )}
        </div>
      </div>
      {asTable && table ? (
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table className="data">
            <thead><tr>{table.head.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

/** Area chart with gradient, grid, crosshair tooltip and draw-in animation. */
export function AreaChart({ data, format = (v) => v, height = 260, color = 'var(--chart-1)' }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const W = 720; const H = height; const pl = 56; const pr = 16; const pt = 16; const pb = 32;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0) * 1.08);
  const xs = (i) => pl + (data.length <= 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (data.length - 1));
  const ys = (v) => pt + (H - pt - pb) * (1 - v / max);
  const pts = data.map((d, i) => [xs(i), ys(d.value)]);
  const line = smooth(pts);
  const area = pts.length ? `${line} L${pts[pts.length - 1][0]},${H - pb} L${pts[0][0]},${H - pb} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend: ${data.map((d) => `${d.short || d.label} ${format(d.value)}`).join(', ')}`}
        onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pl} x2={W - pr} y1={ys(t)} y2={ys(t)} />
            <text className="axis-label" x={pl - 10} y={ys(t) + 4} textAnchor="end">{format(t, true)}</text>
          </g>
        ))}
        {data.map((d, i) => <text key={d.label} className="axis-label" x={xs(i)} y={H - 8} textAnchor="middle">{d.short || d.label}</text>)}
        <motion.path d={area} fill={`url(#fill-${uid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }} />
        <motion.path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: EASE }} />
        {hover != null && (
          <line x1={pts[hover][0]} x2={pts[hover][0]} y1={pt} y2={H - pb} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
        )}
        {pts.map((p, i) => (
          <g key={i}>
            <motion.circle cx={p[0]} cy={p[1]} r={hover === i ? 7 : 4.5} fill="var(--color-surface)" stroke={i === pts.length - 1 ? 'var(--accent)' : color} strokeWidth="3"
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + i * 0.06 }} />
            <rect x={p[0] - (W - pl - pr) / Math.max(1, data.length - 1) / 2} y={pt} width={(W - pl - pr) / Math.max(1, data.length - 1)} height={H - pt - pb}
              fill="transparent" onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100}%` }}>
          <span style={{ opacity: 0.7, fontSize: '0.72rem' }}>{data[hover].full || data[hover].label}</span>
          <b>{format(data[hover].value)}</b>
        </div>
      )}
    </div>
  );
}

/** Donut with animated arcs and centre total. */
export function Donut({ data, format, centerLabel = 'Total', size = 220 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 80; const c = 2 * Math.PI * r;
  const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--color-border-strong)'];
  const segs = useMemo(() => {
    let acc = 0;
    return data.map((d, i) => {
      const frac = d.value / total;
      const s = { ...d, frac, offset: acc, color: colors[Math.min(i, colors.length - 1)] };
      acc += frac;
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, total]);
  const shown = hover != null ? segs[hover] : null;

  return (
    <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
      <div style={{ position: 'relative', width: size, maxWidth: '100%' }}>
        <svg viewBox="0 0 220 220" role="img" aria-label={data.map((d) => `${d.label} ${Math.round((d.value / total) * 100)}%`).join(', ')}>
          <circle cx="110" cy="110" r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth="26" />
          {segs.map((s, i) => (
            <motion.circle key={s.label} cx="110" cy="110" r={r} fill="none" stroke={s.color} strokeWidth={hover === i ? 32 : 26}
              strokeDasharray={`${Math.max(0, s.frac * c - 3)} ${c}`} transform={`rotate(${s.offset * 360 - 90} 110 110)`}
              initial={{ strokeDashoffset: s.frac * c }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.8, delay: 0.1 + i * 0.08, ease: EASE }}
              style={{ cursor: 'pointer', transition: 'stroke-width 160ms' }} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <div>
            <div className="kpi-label">{shown ? shown.label : centerLabel}</div>
            <div className="display-num" style={{ fontSize: '1.35rem' }}>{format(shown ? shown.value : total)}</div>
            {shown && <div className="small muted">{Math.round(shown.frac * 100)}%</div>}
          </div>
        </div>
      </div>
      <div className="legend" style={{ justifyContent: 'center' }}>
        {segs.map((s, i) => (
          <span key={s.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ opacity: hover == null || hover === i ? 1 : 0.45 }}>
            <i style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars with animated widths. */
export function HBars({ data, format, accentFirst = false, max: maxIn }) {
  const max = maxIn || Math.max(...data.map((d) => d.value), 1);
  return (
    <div role="list">
      {data.map((d, i) => (
        <div className="bar-row" role="listitem" key={d.label}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div className="bar-track">
            <motion.div className={`bar-fill ${accentFirst && i === 0 ? 'accent' : ''}`} initial={{ width: 0 }}
              animate={{ width: `${(d.value / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: EASE }} />
          </div>
          <span className="num" style={{ fontSize: '0.8rem', fontWeight: 700 }}>{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bar columns (used for violations / months). */
export function Columns({ data, format, height = 200, highlightMax = true }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const top = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, gap: 10, alignItems: 'end', height }}>
        {data.map((d, i) => (
          <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="small num" style={{ opacity: hover === i || (highlightMax && i === top) ? 1 : 0.6, fontSize: '0.72rem', fontWeight: 700 }}>{format(d.value)}</span>
            <motion.div initial={{ height: 0 }} animate={{ height: `${(d.value / max) * 78}%` }} transition={{ duration: 0.7, delay: i * 0.05, ease: EASE }}
              style={{
                width: '100%', maxWidth: 46, borderRadius: '10px 10px 4px 4px',
                background: highlightMax && i === top ? 'linear-gradient(180deg,#ffc768,var(--accent))' : 'linear-gradient(180deg, color-mix(in oklab, var(--chart-1) 65%, white), var(--chart-1))',
                opacity: hover == null || hover === i ? 1 : 0.55, transition: 'opacity 160ms',
              }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, gap: 10, marginTop: 8 }}>
        {data.map((d) => <span key={d.label} className="small muted" style={{ textAlign: 'center', fontSize: '0.7rem', lineHeight: 1.2 }}>{d.short || d.label}</span>)}
      </div>
    </div>
  );
}

/** Tiny sparkline for KPI cards. */
export function Sparkline({ values, color = 'currentColor', width = 96, height = 30 }) {
  const uid = useId().replace(/:/g, '');
  if (!values?.length) return null;
  const max = Math.max(...values); const min = Math.min(...values);
  const pts = values.map((v, i) => [(i * width) / Math.max(1, values.length - 1), height - 3 - ((v - min) / (max - min || 1)) * (height - 6)]);
  const line = smooth(pts);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <defs><linearGradient id={`sp-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".3" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#sp-${uid})`} />
      <motion.path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: EASE }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

/** Radial progress ring. */
export function Ring({ value, size = 64, stroke = 7, color = 'var(--color-primary)', children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }} transition={{ duration: 1, ease: EASE }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '0.8rem' }}>{children}</div>
    </div>
  );
}
