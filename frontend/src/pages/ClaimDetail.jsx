import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { STEP_LABEL, formatDateTime, formatMoney, get, humanize, post } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, Loading, StatusChip } from '../components/ui.jsx';
import { LineSummary, Timeline, latestComments } from '../components/claim.jsx';

const SUBMIT_MESSAGE = {
  APPROVED: ['success', 'Approved automatically.', 'Every line is within policy. It will be included in the next payout.'],
  SAMPLE_AUDIT: ['info', 'Approved, and picked for a routine sample audit.', 'A finance auditor will take a quick look before it is paid. No action needed from you.'],
  PENDING_APPROVAL: ['info', 'Submitted for approval.', 'Some lines need a reviewer’s eye, or the total needs sign-off. You’ll see each decision below.'],
  AUTO_REJECTED: ['error', 'Blocked by policy.', 'Fix the lines marked “Blocked” below, then edit and submit again.'],
};

export default function ClaimDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  useDocumentTitle(`Claim #${id}`);
  const state = useAsync(() => get(`/api/claims/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [justSubmitted, setJustSubmitted] = useState(location.state?.submitted || null);

  if (state.loading && !state.data) return <Loading label="Loading claim…" />;
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} title="Could not load this claim" />;

  const { claim, lines = [], timeline = [], allowed_actions: allowed = [] } = state.data || {};
  if (!claim) return <ErrorState error={new Error('The server returned an unexpected response.')} onRetry={state.reload} />;
  const canEdit = allowed.includes('edit');
  const canSubmit = allowed.includes('submit');
  const canReview = ['approve', 'reject', 'send_back', 'clear'].some((a) => allowed.includes(a));
  const comments = latestComments(timeline);
  const msg = justSubmitted ? SUBMIT_MESSAGE[claim.status] : null;

  const submit = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await post(`/api/claims/${id}/submit`);
      if (res?.claim) state.setData(res); else await state.reload();
      setJustSubmitted(true);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p><Link to="/claims">← My claims</Link></p>
      <div className="page-head">
        <div>
          <h1>{claim.title || `Claim #${claim.id}`}</h1>
          <p className="page-sub">Claim #{claim.id}{claim.employee_name ? ` · ${claim.employee_name}` : ''}</p>
        </div>
        <div className="row">
          <StatusChip status={claim.status} step={claim.current_step} />
          {canReview && <button type="button" className="btn btn-primary" onClick={() => navigate(`/approvals/${id}`)}>Review</button>}
          {canEdit && <Link to={`/claims/${id}/edit`} className="btn">Edit</Link>}
          {canSubmit && (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msg[0]}`} role={msg[0] === 'error' ? 'alert' : 'status'}>
          <div className="alert-body"><strong>{msg[1]}</strong> {msg[2]}</div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setJustSubmitted(null)} aria-label="Dismiss message">✕</button>
        </div>
      )}
      {actionError && <ErrorState error={actionError} title="Could not submit" />}

      <div className="card">
        <dl className="kv">
          <div><dt>Total</dt><dd>{formatMoney(claim.total_paise)}</dd></div>
          <div><dt>Lines</dt><dd>{lines.length}</dd></div>
          <div><dt>Waiting on</dt><dd>{claim.status === 'PENDING_APPROVAL' ? (STEP_LABEL[claim.current_step] || humanize(claim.current_step) || '—') : '—'}</dd></div>
          <div><dt>Submitted</dt><dd>{formatDateTime(claim.submitted_at)}</dd></div>
          <div><dt>Last update</dt><dd>{formatDateTime(claim.updated_at)}</dd></div>
        </dl>
      </div>

      {comments.length > 0 && (
        <section className="card" aria-labelledby="comments-h">
          <h2 id="comments-h">Approver comments</h2>
          <ul className="line-list">
            {comments.map((c, i) => (
              <li key={c.id ?? i}>
                <strong>{c.actor_name || 'Approver'}</strong> <span className="muted small">({humanize(c.action)} · {formatDateTime(c.created_at || c.at)})</span>
                <div className="comment">“{c.comment || c.details?.comment}”</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="lines-h">
        <h2 id="lines-h">Lines and policy checks</h2>
        {lines.length === 0 ? (
          <p className="muted">This claim has no lines yet. {canEdit && <Link to={`/claims/${id}/edit`}>Add expenses</Link>}</p>
        ) : (
          <ul className="line-list">
            {lines.map((l, i) => (
              <li key={l.id ?? i} className={`line-row outcome-${l.outcome || 'NONE'}`}>
                <LineSummary line={l} index={i} />
                {l.receipt_id && <a className="small" href={`/api/receipts/${l.receipt_id}`} target="_blank" rel="noreferrer">Open receipt<span className="visually-hidden"> for line {i + 1} (opens in new tab)</span></a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="tl-h">
        <h2 id="tl-h">Status timeline</h2>
        <Timeline entries={timeline} />
      </section>
    </>
  );
}
