import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Fingerprint, History, Search, ShieldCheck, Users } from 'lucide-react';
import { STATUS, asList, formatDateTime, get, humanize } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView, EmptyState } from '../components/ui.jsx';
import { Avatar } from '../components/brand.jsx';
import { Count } from '../components/charts.jsx';

const ease = [0.2, 0.8, 0.2, 1];
const istDay = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
const istTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const TONE = { approve: 'success', approved: 'success', paid: 'success', clear: 'success', auto_approve: 'success', reject: 'danger', rejected: 'danger', auto_reject: 'danger', send_back: 'warning', login: 'neutral', policy_update: 'purple' };

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chains SHA-256 over the visible entries (oldest → newest) and animates the sweep. */
function Fingerprinter({ entries }) {
  const [blocks, setBlocks] = useState(null);
  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!crypto?.subtle) return;
    setBusy(true); setStep(-1);
    const sample = [...entries].slice(0, 8).reverse();
    let prev = '0'.repeat(64);
    const out = [];
    for (const e of sample) {
      // eslint-disable-next-line no-await-in-loop
      const h = await sha256(prev + JSON.stringify([e.id, e.at, e.actor_id, e.entity, e.entity_id, e.action, e.from_status, e.to_status, e.comment]));
      out.push({ id: e.id, action: e.action, hash: h }); prev = h;
    }
    setBlocks(out);
    for (let i = 0; i < out.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 160));
      setStep(i);
    }
    setBusy(false);
  };
  return (
    <section className="card" aria-labelledby="fp-h">
      <div className="card-title">
        <div className="row" style={{ gap: 12 }}>
          <span className="kpi-icon"><Fingerprint aria-hidden="true" /></span>
          <div><h2 id="fp-h" style={{ margin: 0 }}>Snapshot fingerprint</h2><div className="sub">SHA-256 chained over the 8 newest entries, computed in your browser</div></div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={busy || !entries.length} aria-busy={busy || undefined}>
          <ShieldCheck aria-hidden="true" /> {busy ? 'Hashing…' : blocks ? 'Recompute' : 'Compute fingerprint'}
        </button>
      </div>
      {!blocks && <p className="small muted" style={{ margin: 0 }}>Compute a fingerprint now and again later: if the two final hashes match, none of these entries changed in between. The server log is append-only.</p>}
      {blocks && (
        <>
          <div className="chain" role="list" aria-label="Hash chain">
            {blocks.map((b, i) => (
              <div key={b.id} style={{ display: 'flex' }} role="listitem">
                {i > 0 && <motion.span className={`link ${step >= i ? 'ok' : ''}`} />}
                <motion.div className={`block ${step >= i ? 'ok' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, scale: step === i ? 1.04 : 1 }} transition={{ delay: i * 0.04, ease }}>
                  <b>#{b.id} · {humanize(b.action)}</b>
                  <span className="mono">{b.hash.slice(0, 10)}…{b.hash.slice(-6)}</span>
                </motion.div>
              </div>
            ))}
          </div>
          {step === blocks.length - 1 && (
            <motion.div className="alert alert-success" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 0 }} role="status">
              <ShieldCheck size={18} aria-hidden="true" />
              <div className="alert-body small"><strong>Fingerprint ready.</strong> Final hash <span className="mono">{blocks[blocks.length - 1].hash.slice(0, 24)}…</span></div>
            </motion.div>
          )}
        </>
      )}
    </section>
  );
}

export default function Activity() {
  useDocumentTitle('Audit trail');
  const state = useAsync(() => get('/api/audit-log', { limit: 300 }), []);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');

  const entries = asList(state.data);
  const filtered = useMemo(() => entries.filter((e) => {
    if (kind === 'claims' && e.entity !== 'claim') return false;
    if (kind === 'decisions' && !['approve', 'approved', 'reject', 'rejected', 'send_back', 'clear'].includes(e.action)) return false;
    if (kind === 'system' && e.entity === 'claim') return false;
    if (!q.trim()) return true;
    return `${e.actor_name} ${e.action} ${e.entity} ${e.entity_id} ${e.comment || ''}`.toLowerCase().includes(q.trim().toLowerCase());
  }), [entries, kind, q]);

  const groups = useMemo(() => {
    const m = new Map();
    filtered.slice(0, 120).forEach((e) => { const k = istDay.format(new Date(e.at)); if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
    return [...m.entries()];
  }, [filtered]);
  const actors = new Set(entries.map((e) => e.actor_id)).size;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Compliance</div>
          <h1>Audit trail</h1>
          <p className="page-sub">Every action in ExpenseFlow, append-only, with who did it, on whose behalf and when (IST).</p>
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-head"><span className="kpi-label">Entries loaded</span><span className="kpi-icon"><History /></span></div><div className="kpi-value"><Count value={entries.length} /></div></div>
        <div className="kpi"><div className="kpi-head"><span className="kpi-label">People involved</span><span className="kpi-icon"><Users /></span></div><div className="kpi-value"><Count value={actors} /></div></div>
        <div className="kpi"><div className="kpi-head"><span className="kpi-label">Latest entry</span><span className="kpi-icon"><ShieldCheck /></span></div><div className="kpi-value" style={{ fontSize: '1.05rem' }}>{entries[0] ? formatDateTime(entries[0].at) : '—'}</div></div>
      </div>

      <Fingerprinter entries={entries} />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter entries">
          {[['all', 'All'], ['claims', 'Claims'], ['decisions', 'Decisions'], ['system', 'Sign-ins & system']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {kind === k && <motion.span layoutId="act-pill" className="seg-pill" />}{l}
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="input-icon" style={{ width: 280, maxWidth: '100%' }}>
          <Search aria-hidden="true" />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, action, claim #" aria-label="Search the audit trail" />
        </div>
      </div>

      <DataView state={state} loadingLabel="Loading audit trail…" isEmpty={() => filtered.length === 0}
        empty={<EmptyState icon={<History />} title="No matching entries">Try another filter or search term.</EmptyState>}>
        {() => (
          <div className="stack">
            {groups.map(([day, list]) => (
              <section key={day} className="card" aria-label={day}>
                <div className="card-title"><h2 style={{ fontSize: '0.95rem' }}>{day}</h2><span className="sub">{list.length} entr{list.length === 1 ? 'y' : 'ies'}</span></div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  <AnimatePresence initial={false}>
                    {list.map((e, i) => (
                      <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}
                        className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px dashed var(--color-border)', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                        <Avatar name={e.actor_name || 'System'} size={32} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <b className="small">{e.actor_name || 'System'}</b>
                            <span className={`chip chip-${TONE[e.action] || 'info'}`}>{humanize(e.action)}</span>
                            {e.entity === 'claim' && <Link className="small" to={`/claims/${e.entity_id}`}>Claim #{e.entity_id}</Link>}
                            {e.on_behalf_of_id && <span className="chip chip-purple chip-plain">on behalf of #{e.on_behalf_of_id}</span>}
                          </div>
                          {(e.from_status || e.to_status) && (
                            <div className="small muted">{STATUS[e.from_status]?.label || humanize(e.from_status) || '—'} → <b>{STATUS[e.to_status]?.label || humanize(e.to_status)}</b></div>
                          )}
                          {e.comment && <div className="comment">“{e.comment}”</div>}
                        </div>
                        <time className="small muted mono" dateTime={e.at} style={{ whiteSpace: 'nowrap' }}>{istTime.format(new Date(e.at))}</time>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
            {filtered.length > 120 && <p className="small muted" style={{ textAlign: 'center' }}>Showing the newest 120 of {filtered.length} matching entries.</p>}
          </div>
        )}
      </DataView>
    </>
  );
}
