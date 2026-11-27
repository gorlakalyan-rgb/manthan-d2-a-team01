import { Link } from 'react-router-dom';
import { asList, formatMoney, get } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView, EmptyState } from '../components/ui.jsx';
import QueueTable from '../components/QueueTable.jsx';

export default function Inbox() {
  useDocumentTitle('Approvals');
  const state = useAsync(() => get('/api/approvals/inbox').then((d) => asList(d, 'claims')), []);
  const rows = state.data || [];
  const total = rows.reduce((s, r) => s + (Number(r.total_paise) || 0), 0);
  const flagged = rows.filter((r) => (Array.isArray(r.flags) ? r.flags.length : r.flags && Object.keys(r.flags).length)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals inbox</h1>
          <p className="page-sub">Claims waiting for you (or someone you are covering for), oldest first.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={state.reload} disabled={state.loading} aria-busy={state.loading || undefined}>
            {state.loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/delegations" className="btn btn-ghost">Delegation</Link>
        </div>
      </div>
      {rows.length > 0 && (
        <p className="muted" aria-live="polite">
          <strong>{rows.length}</strong> waiting · <strong>{formatMoney(total)}</strong> in total · <strong>{flagged}</strong> with policy flags
        </p>
      )}
      <DataView
        state={state}
        loadingLabel="Loading your approvals…"
        isEmpty={(d) => !d.length}
        empty={<EmptyState icon="🎉" title="You’re all caught up">No claims are waiting for your approval right now. New ones appear here as soon as they are submitted.</EmptyState>}
      >
        {(data) => <QueueTable rows={data} caption="Claims waiting for your approval" />}
      </DataView>
    </>
  );
}
