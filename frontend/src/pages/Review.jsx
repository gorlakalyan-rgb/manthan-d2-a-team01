import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS, STEP_LABEL, api, formatDateTime, formatMoney, get, humanize, post } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, FieldError, Loading, StatusChip } from '../components/ui.jsx';
import { LineSummary, Timeline } from '../components/claim.jsx';

const ACTIONS = {
  approve: { label: 'Approve', tone: 'success', needsComment: false, done: 'Approved' },
  clear: { label: 'Clear sample audit', tone: 'success', needsComment: false, done: 'Cleared' },
  send_back: { label: 'Send back', tone: '', needsComment: true, done: 'Sent back for clarification' },
  reject: { label: 'Reject', tone: 'danger', needsComment: true, done: 'Rejected' },
};
const ORDER = ['approve', 'clear', 'send_back', 'reject'];

function ReceiptViewer({ receiptId, lineLabel }) {
  const [view, setView] = useState({ url: null, type: '', loading: false, error: null });
  const [attempt, setAttempt] = useState(0);

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
        {receiptId && <a className="small" href={`/api/receipts/${receiptId}`} target="_blank" rel="noreferrer">Open in new tab</a>}
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
        {view.url && !view.type.includes('pdf') && <img src={view.url} alt={`Receipt for ${lineLabel}`} />}
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
      setComment('');
    } catch (err) {
      setError(err);
      if (err.status === 409) state.reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p><Link to="/approvals">← Approvals inbox</Link></p>
      <div className="page-head">
        <div>
          <h1>{claim.title || `Claim #${claim.id}`}</h1>
          <p className="page-sub">#{claim.id} · {claim.employee_name || 'Employee'}{claim.department ? ` · ${claim.department}` : ''}</p>
        </div>
        <StatusChip status={claim.status} step={claim.current_step} />
      </div>

      {done && (
        <div className="alert alert-success" role="status">
          <div className="alert-body"><strong>{done}.</strong> The claim is now “{STATUS[claim.status]?.label || humanize(claim.status)}”. <Link to="/approvals">Back to inbox</Link></div>
        </div>
      )}
      {error && <ErrorState error={error} title={error.status === 409 ? 'Someone else acted first' : 'Action failed'} />}

      <div className="split">
        <div>
          <div className="card">
            <dl className="kv">
              <div><dt>Total</dt><dd>{formatMoney(claim.total_paise)}</dd></div>
              <div><dt>Step</dt><dd>{STEP_LABEL[claim.current_step] || (claim.status === 'SAMPLE_AUDIT' ? 'Sample audit' : '—')}</dd></div>
              <div><dt>Policy flags</dt><dd>{flaggedCount ? `${flaggedCount} of ${lines.length} lines` : 'None'}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDateTime(claim.submitted_at)}</dd></div>
            </dl>
          </div>
          <section className="card" aria-labelledby="rl-h">
            <h2 id="rl-h">Lines</h2>
            <p className="muted small">Select a line to view its receipt.</p>
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
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {actions.map((a) => (
                  <button key={a} type="button" className={`btn ${ACTIONS[a].tone ? `btn-${ACTIONS[a].tone}` : ''}`}
                    onClick={() => act(a)} disabled={!!busy} aria-busy={busy === a || undefined}>
                    {busy === a ? 'Working…' : ACTIONS[a].label}
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
