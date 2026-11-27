import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Maximize2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { STATUS, STEP_LABEL, api, asList, formatDateTime, formatMoney, get, humanize, post } from '../api.js';
import { useToast } from '../toast.jsx';
import { Avatar } from '../components/brand.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, FieldError, Loading, StatusChip } from '../components/ui.jsx';
import { LineSummary, Timeline } from '../components/claim.jsx';

const ACTIONS = {
  approve: { label: 'Approve', tone: 'success', needsComment: false, done: 'Approved', key: 'A', stamp: ['Approved', 'var(--color-success)'] },
  clear: { label: 'Clear sample audit', tone: 'success', needsComment: false, done: 'Cleared', key: 'A', stamp: ['Cleared', 'var(--color-success)'] },
  send_back: { label: 'Send back', tone: '', needsComment: true, done: 'Sent back for clarification', key: 'S', stamp: ['Sent back', 'var(--color-warning)'] },
  reject: { label: 'Reject', tone: 'danger', needsComment: true, done: 'Rejected', key: 'R', stamp: ['Rejected', 'var(--color-danger)'] },
};
const TEMPLATES = ['Please attach the GST invoice.', 'Please split this by date.', 'Receipt is unreadable, please re-upload.', 'Not a business expense under policy.'];

/** Manager → Auditor (> ₹25,000) → Head (> ₹1,00,000) */
function RouteSteps({ claim }) {
  const total = Number(claim.total_paise) || 0;
  const steps = [['MANAGER', 'Manager', 'Reporting line']];
  if (total > 2500000) steps.push(['AUDITOR', 'Finance auditor', 'Above ₹25,000']);
  if (total > 10000000) steps.push(['HEAD', 'Finance head', 'Above ₹1,00,000']);
  const finished = ['APPROVED', 'IN_PAYOUT', 'PAID'].includes(claim.status);
  const cur = steps.findIndex((x) => x[0] === claim.current_step);
  return (
    <div className="route" aria-label="Approval route">
      {steps.map(([code, label, why], i) => {
        const done = finished || (cur >= 0 && i < cur);
        const now = !finished && i === cur && claim.status === 'PENDING_APPROVAL';
        return (
          <div key={code} className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
            {i > 0 && <motion.span className={`route-line ${done || now ? 'done' : ''}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.15 }} style={{ transformOrigin: 'left' }} />}
            <motion.div className={`route-step ${done ? 'done' : ''} ${now ? 'now' : ''}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.15 }} title={why}>
              <span className="route-dot">{done ? <Check /> : i + 1}</span>
              <span><span style={{ display: 'block' }}>{label}</span><span className="small muted" style={{ fontWeight: 500 }}>{now ? 'Waiting now' : done ? 'Done' : why}</span></span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
const ORDER = ['approve', 'clear', 'send_back', 'reject'];

function ReceiptViewer({ receiptId, lineLabel }) {
  const [view, setView] = useState({ url: null, type: '', loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  useEffect(() => { setZoom(1); setRot(0); }, [receiptId]);

  useEffect(() => {
    if (!receiptId) { setView({ url: null, type: '', loading: false, error: null }); return undefined; }
    let url = null;
    let cancelled = false;
    setView({ url: null, type: '', loading: true, error: null });
    api(`/api/receipts/${receiptId}`, { raw: true })
      .then(async (res) => {
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setView({ url, type: blob.type || res.headers.get('content-type') || '', loading: false, error: null });
      })
      .catch((error) => { if (!cancelled) setView({ url: null, type: '', loading: false, error }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [receiptId, attempt]);

  return (
    <section className="card receipt-viewer" aria-labelledby="rv-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="rv-h" style={{ margin: 0 }}>Receipt</h2>
        {receiptId && (
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out"><ZoomOut /></button>
            <span className="small mono" style={{ minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in"><ZoomIn /></button>
            <button type="button" className="icon-btn" onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotate"><RotateCw /></button>
            <a className="icon-btn" href={`/api/receipts/${receiptId}`} target="_blank" rel="noreferrer" aria-label="Open in new tab"><Maximize2 /></a>
          </div>
        )}
      </div>
      <p className="muted small" aria-live="polite">{lineLabel}</p>
      <div className="receipt-frame">
        {!receiptId && <p className="muted state">No receipt attached to this line.</p>}
        {view.loading && <p role="status"><span className="spinner" aria-hidden="true" /> Loading receipt…</p>}
        {view.error && <div style={{ padding: 16 }}><ErrorState error={view.error} onRetry={() => setAttempt((a) => a + 1)} title="Could not load the receipt" /></div>}
        {view.url && view.type.includes('pdf') && (
          <object data={view.url} type="application/pdf" aria-label={`Receipt PDF, ${lineLabel}`}>
            <iframe src={view.url} title={`Receipt PDF, ${lineLabel}`} />
          </object>
        )}
        {view.url && !view.type.includes('pdf') && (
          <div style={{ overflow: 'auto', width: '100%', height: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
            <motion.img src={view.url} alt={`Receipt for ${lineLabel}`} animate={{ scale: zoom, rotate: rot }} transition={{ type: 'spring', stiffness: 300, damping: 28 }} drag={zoom > 1} dragMomentum={false} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function Review() {
  const { id } = useParams();
  useDocumentTitle(`Review claim #${id}`);
  const state = useAsync(() => get(`/api/claims/${id}`), [id]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [comment, setComment] = useState('');
  const [commentErr, setCommentErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [stamp, setStamp] = useState(null);
  const [pressed, setPressed] = useState(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const actRef = useRef(null);
  useEffect(() => { setStamp(null); setDone(null); setActiveIdx(0); }, [id]);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || document.querySelector('dialog[open], .cmdk')) {
        if (e.key === 'Escape' && t.tagName === 'TEXTAREA') t.blur();
        return;
      }
      const k = e.key.toLowerCase();
      const map = { a: ['approve', 'clear'], s: ['send_back'], r: ['reject'] };
      if (map[k] && actRef.current) {
        const a = map[k].find((x) => actRef.current.actions.includes(x));
        if (a) { e.preventDefault(); setPressed(k.toUpperCase()); setTimeout(() => setPressed(null), 180); actRef.current.act(a); }
      } else if (k === 'j' || k === 'k') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, Math.min((actRef.current?.count || 1) - 1, i + (k === 'j' ? 1 : -1))));
      } else if (e.key === 'Escape') { navigate('/approvals'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const nextClaim = async () => {
    try {
      const inbox = asList(await get('/api/approvals/inbox'));
      const next = inbox.find((c) => String(c.id) !== String(id));
      if (next) navigate(`/approvals/${next.id}`); else { toast('Inbox cleared', { body: 'Nothing else is waiting for you.', kind: 'success' }); navigate('/approvals'); }
    } catch { navigate('/approvals'); }
  };

  if (state.loading && !state.data) return <Loading label="Loading claim for review…" />;
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} title="Could not load this claim" />;

  const { claim, lines = [], timeline = [], allowed_actions: allowed = [] } = state.data || {};
  if (!claim) return <ErrorState error={new Error('The server returned an unexpected response.')} onRetry={state.reload} />;
  const actions = ORDER.filter((a) => allowed.includes(a));
  const active = lines[activeIdx] || lines[0];
  const flaggedCount = lines.filter((l) => l.outcome && l.outcome !== 'APPROVE').length;

  const act = async (action) => {
    const spec = ACTIONS[action];
    setError(null);
    if (spec.needsComment && !comment.trim()) {
      setCommentErr(action === 'reject'
        ? 'Add a comment so the employee knows why the claim was rejected.'
        : 'Add a comment telling the employee what to clarify or fix.');
      document.getElementById('review-comment')?.focus();
      return;
    }
    setCommentErr('');
    setBusy(action);
    try {
      const res = await post(`/api/claims/${id}/actions`, { action, comment: comment.trim() });
      if (res?.claim) state.setData(res); else await state.reload();
      setDone(spec.done);
      setStamp(spec.stamp);
      setComment('');
      toast(`${spec.done} · claim #${id}`, { kind: 'success', action: { label: 'Open next claim →', onClick: nextClaim } });
    } catch (err) {
      setError(err);
      if (err.status === 409) { state.reload(); toast('Someone else acted first', { kind: 'error', body: 'We reloaded the latest version of this claim.' }); }
    } finally {
      setBusy(null);
    }
  };

  actRef.current = { actions, act, count: lines.length };

  return (
    <>
      <p><Link to="/approvals" className="btn btn-ghost btn-sm" style={{ paddingLeft: 4 }}><ArrowLeft aria-hidden="true" /> Approvals inbox <span className="kbd">Esc</span></Link></p>
      <div className="page-head">
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <Avatar name={claim.employee_name || 'Employee'} size={52} />
          <div>
            <h1>{claim.title || `Claim #${claim.id}`}</h1>
            <p className="page-sub">#{claim.id} · {claim.employee_name || 'Employee'}{claim.department ? ` · ${claim.department}` : ''}</p>
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 10 }}>
          <StatusChip status={claim.status} step={claim.current_step} />
          <RouteSteps claim={claim} />
        </div>
      </div>

      {done && (
        <div className="alert alert-success" role="status">
          <div className="alert-body"><strong>{done}.</strong> The claim is now “{STATUS[claim.status]?.label || humanize(claim.status)}”.</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={nextClaim}>Next claim <ArrowRight aria-hidden="true" /></button>
        </div>
      )}
      {error && <ErrorState error={error} title={error.status === 409 ? 'Someone else acted first' : 'Action failed'} />}

      <div className="split">
        <div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <AnimatePresence>
              {stamp && (
                <motion.div className="stamp" style={{ color: stamp[1] }} initial={{ scale: 1.6, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -8 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 18 }} aria-hidden="true">{stamp[0]}</motion.div>
              )}
            </AnimatePresence>
            <dl className="kv">
              <div><dt>Total</dt><dd className="display-num" style={{ fontSize: '1.5rem' }}>{formatMoney(claim.total_paise)}</dd></div>
              <div><dt>Step</dt><dd>{STEP_LABEL[claim.current_step] || (claim.status === 'SAMPLE_AUDIT' ? 'Sample audit' : '—')}</dd></div>
              <div><dt>Policy flags</dt><dd>{flaggedCount ? `${flaggedCount} of ${lines.length} lines` : 'None'}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDateTime(claim.submitted_at)}</dd></div>
            </dl>
          </div>
          <section className="card" aria-labelledby="rl-h">
            <h2 id="rl-h">Lines</h2>
            <p className="muted small">Select a line to view its receipt · <span className="kbd">J</span> <span className="kbd">K</span> to move between lines.</p>
            <ul className="line-list">
              {lines.map((l, i) => (
                <li key={l.id ?? i}>
                  <button type="button" className={`line-row outcome-${l.outcome || 'NONE'}`} aria-pressed={active === l}
                    onClick={() => setActiveIdx(i)}>
                    <LineSummary line={l} index={i} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {actions.length > 0 ? (
            <section className="card" aria-labelledby="dec-h">
              <h2 id="dec-h">Your decision</h2>
              <div className="field">
                <label htmlFor="review-comment">Comment <span className="muted">(required to reject or send back)</span></label>
                <textarea id="review-comment" className="input" value={comment} maxLength={1000}
                  onChange={(e) => { setComment(e.target.value); setCommentErr(''); }}
                  aria-invalid={!!commentErr} aria-describedby={commentErr ? 'comment-err' : undefined}
                  placeholder="e.g. Please attach the hotel invoice for night 2." />
                <FieldError id="comment-err">{commentErr}</FieldError>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {TEMPLATES.map((t) => <button key={t} type="button" className="chip chip-neutral chip-plain" style={{ cursor: 'pointer' }} onClick={() => { setComment(t); setCommentErr(''); }}>{t}</button>)}
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {actions.map((a) => (
                  <button key={a} type="button" className={`btn ${ACTIONS[a].tone ? `btn-${ACTIONS[a].tone}` : ''}`}
                    onClick={() => act(a)} disabled={!!busy} aria-busy={busy === a || undefined}>
                    {busy === a ? 'Working…' : ACTIONS[a].label}
                    <span className={`kbd ${pressed === ACTIONS[a].key ? 'pressed' : ''}`} aria-hidden="true">{ACTIONS[a].key}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="alert alert-info" role="status"><div className="alert-body">No actions are available to you on this claim right now.</div></div>
          )}

          <section className="card" aria-labelledby="rt-h">
            <h2 id="rt-h">Timeline</h2>
            <Timeline entries={timeline} />
          </section>
        </div>
        <div className="sticky-col">
          <ReceiptViewer receiptId={active?.receipt_id}
            lineLabel={active ? `Line ${lines.indexOf(active) + 1}: ${active.vendor || ''} ${formatMoney(active.amount_paise)}` : 'No lines'} />
        </div>
      </div>
    </>
  );
}
