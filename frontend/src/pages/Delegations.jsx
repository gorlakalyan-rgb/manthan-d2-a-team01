import { useState } from 'react';
import { asList, del, formatDate, get, humanize, post, todayYmd } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ConfirmDialog, DataView, ErrorState, FieldError, Notice } from '../components/ui.jsx';

function splitDelegations(data, userId) {
  if (data && !Array.isArray(data) && (data.given || data.received)) {
    return { given: data.given || [], received: data.received || [] };
  }
  const all = asList(data, 'delegations');
  return {
    given: all.filter((d) => d.delegator_id === userId),
    received: all.filter((d) => d.delegate_id === userId && d.delegator_id !== userId),
  };
}

function windowState(d) {
  const t = todayYmd();
  if (d.end_date < t) return ['neutral', 'Ended'];
  if (d.start_date > t) return ['info', 'Scheduled'];
  return ['success', 'Active now'];
}

export default function Delegations() {
  useDocumentTitle('Delegation');
  const { user } = useAuth();
  const list = useAsync(() => get('/api/delegations'), []);
  const approvers = useAsync(() => get('/api/users/approvers').then((d) => asList(d, 'users')), []);
  const [form, setForm] = useState({ delegate_id: '', start_date: todayYmd(), end_date: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const options = (approvers.data || []).filter((u) => u.id !== user.id);

  const create = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.delegate_id) errs.delegate_id = 'Choose who will approve while you are away.';
    if (!form.start_date) errs.start_date = 'Pick a start date.';
    if (!form.end_date) errs.end_date = 'Pick an end date.';
    else if (form.start_date && form.end_date < form.start_date) errs.end_date = 'The end date must be on or after the start date.';
    setErrors(errs);
    setFormError(null);
    setNotice('');
    if (Object.keys(errs).length) {
      document.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    try {
      await post('/api/delegations', { delegate_id: Number(form.delegate_id), start_date: form.start_date, end_date: form.end_date });
      const who = options.find((u) => String(u.id) === String(form.delegate_id));
      setNotice(`${who?.name || 'Your delegate'} can approve on your behalf from ${formatDate(form.start_date)} to ${formatDate(form.end_date)}.`);
      setForm({ delegate_id: '', start_date: todayYmd(), end_date: '' });
      list.reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await del(`/api/delegations/${toDelete.id}`);
      setToDelete(null);
      setNotice('Delegation removed.');
      list.reload();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleting(false);
    }
  };

  const nameOf = (d, which) => d[`${which}_name`] || d[which]?.name || options.find((u) => u.id === d[`${which}_id`])?.name || `User #${d[`${which}_id`]}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Delegation</h1>
          <p className="page-sub">Going on leave? Let a colleague approve claims for you during a date range. Everything they do is logged “on behalf of” you.</p>
        </div>
      </div>
      <Notice onClose={() => setNotice('')}>{notice}</Notice>

      <form className="card" onSubmit={create} noValidate aria-labelledby="new-del-h">
        <h2 id="new-del-h">New delegation</h2>
        {formError && <ErrorState error={formError} title="Could not create the delegation" />}
        {approvers.error && <ErrorState error={approvers.error} onRetry={approvers.reload} title="Could not load the list of approvers" />}
        <div className="grid-form cols-4">
          <div className="field">
            <label htmlFor="delegate">Delegate</label>
            <select id="delegate" className="input" value={form.delegate_id} disabled={approvers.loading}
              onChange={(e) => setForm({ ...form, delegate_id: e.target.value })}
              aria-invalid={!!errors.delegate_id} aria-describedby={errors.delegate_id ? 'delegate-err' : undefined}>
              <option value="">{approvers.loading ? 'Loading…' : 'Choose a colleague'}</option>
              {options.map((u) => <option key={u.id} value={u.id}>{u.name} · {humanize(u.role)}{u.department ? `, ${u.department}` : ''}</option>)}
            </select>
            <FieldError id="delegate-err">{errors.delegate_id}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="start">From</label>
            <input id="start" type="date" className="input" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              aria-invalid={!!errors.start_date} aria-describedby={errors.start_date ? 'start-err' : undefined} />
            <FieldError id="start-err">{errors.start_date}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="end">To</label>
            <input id="end" type="date" className="input" value={form.end_date} min={form.start_date || undefined}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              aria-invalid={!!errors.end_date} aria-describedby={errors.end_date ? 'end-err' : undefined} />
            <FieldError id="end-err">{errors.end_date}</FieldError>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Create delegation'}</button>
          </div>
        </div>
      </form>

      <DataView state={list} loadingLabel="Loading delegations…">
        {(data) => {
          const { given, received } = splitDelegations(data, user.id);
          return (
            <>
              <section className="card" aria-labelledby="given-h">
                <h2 id="given-h">Delegations you gave</h2>
                {given.length === 0 ? <p className="muted">You have not delegated your approvals. Create one above before you go on leave.</p> : (
                  <div className="table-wrap">
                    <table className="data responsive">
                      <thead><tr><th scope="col">Delegate</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                      <tbody>
                        {given.map((d) => {
                          const [tone, label] = windowState(d);
                          return (
                            <tr key={d.id}>
                              <td data-label="Delegate" className="cell-strong">{nameOf(d, 'delegate')}</td>
                              <td data-label="From">{formatDate(d.start_date)}</td>
                              <td data-label="To">{formatDate(d.end_date)}</td>
                              <td data-label="Status"><span className={`chip chip-${tone}`}>{label}</span></td>
                              <td data-label="Actions"><button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDeleteError(null); setToDelete(d); }}>Delete<span className="visually-hidden"> delegation to {nameOf(d, 'delegate')}</span></button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="card" aria-labelledby="recv-h">
                <h2 id="recv-h">Delegations to you</h2>
                {received.length === 0 ? <p className="muted">Nobody has delegated their approvals to you.</p> : (
                  <ul className="line-list">
                    {received.map((d) => {
                      const [tone, label] = windowState(d);
                      return (
                        <li key={d.id} className="line-row">
                          <strong>{nameOf(d, 'delegator')}</strong> · {formatDate(d.start_date)} – {formatDate(d.end_date)} <span className={`chip chip-${tone}`}>{label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </DataView>

      <ConfirmDialog open={!!toDelete} title="Delete this delegation?" confirmLabel="Delete" tone="danger" busy={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)}>
        <p>{toDelete && `${nameOf(toDelete, 'delegate')} will no longer be able to approve on your behalf.`}</p>
        {deleteError && <ErrorState error={deleteError} title="Could not delete" />}
      </ConfirmDialog>
    </>
  );
}
