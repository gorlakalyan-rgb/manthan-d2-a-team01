import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asList, formatDateTime, formatMoney, get, humanize, post } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ConfirmDialog, DataView, EmptyState, ErrorState, Notice } from '../components/ui.jsx';

function isPaid(b) {
  return String(b.status || '').toUpperCase() === 'PAID' || !!b.paid_at;
}

export default function Payouts() {
  useDocumentTitle('Payouts');
  const eligible = useAsync(() => get('/api/payouts/eligible').then((d) => asList(d, 'claims')), []);
  const batches = useAsync(() => get('/api/payouts').then((d) => asList(d, 'batches')), []);
  const [selected, setSelected] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [notice, setNotice] = useState('');
  const [toPay, setToPay] = useState(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(null);

  const rows = eligible.data || [];
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = rows.some((r) => selected.has(r.id));
  const selTotal = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + (Number(r.total_paise) || 0), 0);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const createBatch = async () => {
    setCreating(true);
    setCreateError(null);
    setNotice('');
    try {
      const b = await post('/api/payouts', { claim_ids: [...selected] });
      const batch = b?.batch || b;
      setNotice(`Batch #${batch?.id ?? ''} created with ${selected.size} claim${selected.size === 1 ? '' : 's'} (${formatMoney(selTotal)}). Download the bank file, then mark it paid once the transfer is done.`);
      setSelected(new Set());
      eligible.reload();
      batches.reload();
    } catch (err) {
      setCreateError(err);
    } finally {
      setCreating(false);
    }
  };

  const markPaid = async () => {
    setPaying(true);
    setPayError(null);
    try {
      await post(`/api/payouts/${toPay.id}/mark-paid`);
      setNotice(`Batch #${toPay.id} marked as paid. Its claims now show “Paid” to employees.`);
      setToPay(null);
      batches.reload();
    } catch (err) {
      setPayError(err);
    } finally {
      setPaying(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <p className="page-sub">Group approved claims into a batch, download the bank file, then mark the batch paid.</p>
        </div>
      </div>
      <Notice onClose={() => setNotice('')}>{notice}</Notice>

      <section aria-labelledby="elig-h" className="card">
        <h2 id="elig-h">1. Approved claims ready to pay</h2>
        {createError && <ErrorState error={createError} title="Could not create the batch" />}
        <DataView state={eligible} loadingLabel="Loading approved claims…" isEmpty={(d) => !d.length}
          empty={<p className="muted">No approved claims are waiting for payout. Claims appear here once fully approved (and cleared, if sampled).</p>}>
          {(data) => (
            <>
              <div className="toolbar" aria-live="polite">
                <span className="grow">{selected.size ? <><strong>{selected.size}</strong> selected · <strong>{formatMoney(selTotal)}</strong></> : <span className="muted">{data.length} claims ready</span>}</span>
                <button type="button" className="btn btn-primary" disabled={!selected.size || creating} aria-busy={creating || undefined} onClick={createBatch}>
                  {creating ? 'Creating…' : `Create batch${selected.size ? ` (${selected.size})` : ''}`}
                </button>
              </div>
              <div className="table-wrap">
                <table className="data responsive">
                  <caption className="visually-hidden">Approved claims eligible for payout</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="check-cell">
                        <label>
                          <input type="checkbox" className="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                            onChange={(e) => setSelected(e.target.checked ? new Set(data.map((r) => r.id)) : new Set())} />
                          <span className="visually-hidden">Select all</span>
                        </label>
                      </th>
                      <th scope="col">Claim</th><th scope="col">Employee</th><th scope="col">Department</th><th scope="col" className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r) => (
                      <tr key={r.id} className={selected.has(r.id) ? 'selected' : undefined}>
                        <td className="check-cell"><label><input type="checkbox" className="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /><span className="visually-hidden">Select claim #{r.id}</span></label></td>
                        <td data-label="Claim"><Link to={`/claims/${r.id}`}>#{r.id} {r.title}</Link></td>
                        <td data-label="Employee">{r.employee_name || '—'}</td>
                        <td data-label="Department">{r.department || '—'}</td>
                        <td data-label="Total" className="num cell-strong">{formatMoney(r.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DataView>
      </section>

      <section aria-labelledby="batches-h" className="card">
        <h2 id="batches-h">2. Payout batches</h2>
        <DataView state={batches} loadingLabel="Loading batches…" isEmpty={(d) => !d.length}
          empty={<EmptyState icon="🏦" title="No batches yet">Select approved claims above and create your first batch.</EmptyState>}>
          {(data) => (
            <div className="table-wrap">
              <table className="data responsive">
                <caption className="visually-hidden">Payout batches</caption>
                <thead><tr><th scope="col">Batch</th><th scope="col">Created</th><th scope="col" className="num">Claims</th><th scope="col" className="num">Total</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {data.map((b) => {
                    const paid = isPaid(b);
                    return (
                      <tr key={b.id}>
                        <td data-label="Batch" className="cell-strong">#{b.id}</td>
                        <td data-label="Created">{formatDateTime(b.created_at)}</td>
                        <td data-label="Claims" className="num">{b.claim_count ?? b.item_count ?? b.items?.length ?? '—'}</td>
                        <td data-label="Total" className="num cell-strong">{formatMoney(b.total_paise)}</td>
                        <td data-label="Status"><span className={`chip ${paid ? 'chip-success' : 'chip-info'}`}>{paid ? 'Paid' : humanize(b.status || 'Created')}</span>{paid && b.paid_at && <span className="cell-sub">{formatDateTime(b.paid_at)}</span>}</td>
                        <td data-label="Actions">
                          <div className="row">
                            <a className="btn btn-sm" href={`/api/payouts/${b.id}/csv`} download={`payout-batch-${b.id}.csv`}>Download CSV<span className="visually-hidden"> for batch {b.id}</span></a>
                            {!paid && <button type="button" className="btn btn-sm btn-primary" onClick={() => { setPayError(null); setToPay(b); }}>Mark paid<span className="visually-hidden"> batch {b.id}</span></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataView>
      </section>

      <ConfirmDialog open={!!toPay} title={`Mark batch #${toPay?.id ?? ''} as paid?`} confirmLabel="Yes, mark paid" busy={paying}
        onConfirm={markPaid} onCancel={() => setToPay(null)}>
        <p>Confirm the bank transfer of <strong>{formatMoney(toPay?.total_paise)}</strong> is complete. Every claim in this batch moves to <strong>Paid</strong>. This cannot be undone.</p>
        {payError && <ErrorState error={payError} title="Could not mark as paid" />}
      </ConfirmDialog>
    </>
  );
}
