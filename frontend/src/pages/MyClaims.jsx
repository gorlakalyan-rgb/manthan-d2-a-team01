import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS, asList, formatDateTime, formatMoney, get } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView, EmptyState, Flags, StatusChip } from '../components/ui.jsx';

export default function MyClaims() {
  useDocumentTitle('My claims');
  const [status, setStatus] = useState('');
  const state = useAsync(() => get('/api/claims', { status }).then((d) => asList(d, 'claims')), [status]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My claims</h1>
          <p className="page-sub">Track every claim you have filed, from draft to paid.</p>
        </div>
        <Link to="/claims/new" className="btn btn-primary">+ New claim</Link>
      </div>
      <div className="toolbar">
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="status-filter">Show</label>
          <select id="status-filter" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <DataView
        state={state}
        loadingLabel="Loading your claims…"
        isEmpty={(d) => !d.length}
        empty={
          <EmptyState icon="🧾" title={status ? 'No claims with this status' : 'No claims yet'}
            action={!status && <Link to="/claims/new" className="btn btn-primary">Start your first claim</Link>}>
            {status ? 'Try “All statuses” to see everything.' : 'Add your expenses as line items, attach receipts and submit. We check each line against policy instantly.'}
          </EmptyState>
        }
      >
        {(claims) => (
          <ul className="claim-list" aria-label={`${claims.length} claims`}>
            {claims.map((c) => (
              <li key={c.id} className="claim-item">
                <Link to={`/claims/${c.id}`}>
                  <span className="claim-title">{c.title || `Claim #${c.id}`}</span>
                  <span className="claim-amount">{formatMoney(c.total_paise)}</span>
                  <span className="claim-meta">
                    #{c.id} · {c.line_count ?? 0} line{c.line_count === 1 ? '' : 's'} · {c.submitted_at ? `Submitted ${formatDateTime(c.submitted_at)}` : `Updated ${formatDateTime(c.updated_at)}`}
                  </span>
                  <span style={{ textAlign: 'right' }}><StatusChip status={c.status} step={c.current_step} /></span>
                  {c.flags && (Array.isArray(c.flags) ? c.flags.length > 0 : Object.keys(c.flags).length > 0) && (
                    <span style={{ gridColumn: '1 / -1' }}><Flags flags={c.flags} /></span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DataView>
    </>
  );
}
