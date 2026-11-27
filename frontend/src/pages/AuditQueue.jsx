import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, RULE_COPY, STATUS, asList, categoryLabel, formatMoney, get, post, rupeesToPaise } from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ConfirmDialog, DataView, EmptyState, ErrorState, FieldError } from '../components/ui.jsx';
import QueueTable from '../components/QueueTable.jsx';

const EMPTY_FILTERS = { kind: 'all', department: '', category: '', flag: '', min: '', max: '', q: '' };

export default function AuditQueue() {
  useDocumentTitle('Audit queue');
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterErr, setFilterErr] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [results, setResults] = useState(null);
  const [departments, setDepartments] = useState([]);

  const state = useAsync(async () => {
    const rows = asList(await get('/api/audit/queue', {
      kind: filters.kind,
      department: filters.department,
      category: filters.category,
      flag: filters.flag,
      min_paise: filters.min ? rupeesToPaise(filters.min) : '',
      max_paise: filters.max ? rupeesToPaise(filters.max) : '',
      q: filters.q.trim(),
    }), 'claims');
    setDepartments((prev) => [...new Set([...prev, ...rows.map((r) => r.department).filter(Boolean)])].sort());
    setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))));
    return rows;
  }, [filters]);

  const rows = useMemo(() => state.data || [], [state.data]);
  const resultMap = useMemo(() => (results ? Object.fromEntries(results.map((r) => [r.claim_id, r])) : null), [results]);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedSample = selectedRows.filter((r) => r.status === 'SAMPLE_AUDIT').length;
  const selectedTotal = selectedRows.reduce((s, r) => s + (Number(r.total_paise) || 0), 0);

  const apply = (e) => {
    e?.preventDefault();
    const errs = {};
    const min = draft.min ? rupeesToPaise(draft.min) : null;
    const max = draft.max ? rupeesToPaise(draft.max) : null;
    if (draft.min && (Number.isNaN(min) || min < 0)) errs.min = 'Enter a positive rupee amount.';
    if (draft.max && (Number.isNaN(max) || max < 0)) errs.max = 'Enter a positive rupee amount.';
    if (!errs.min && !errs.max && min !== null && max !== null && min > max) errs.max = 'Max must be at least the min.';
    setFilterErr(errs);
    if (Object.keys(errs).length) return;
    setResults(null);
    setFilters({ ...draft });
  };
  const reset = () => { setDraft(EMPTY_FILTERS); setFilterErr({}); setFilters(EMPTY_FILTERS); };
  const setKind = (kind) => { const next = { ...draft, kind }; setDraft(next); setFilters({ ...filters, kind }); };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = (on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());

  const bulkApprove = async () => {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await post('/api/approvals/bulk', { claim_ids: [...selected], action: 'approve', comment: comment.trim() });
      const list = asList(res, 'results');
      setResults(list);
      setConfirming(false);
      setComment('');
      setSelected(new Set(list.filter((r) => !r.ok).map((r) => r.claim_id)));
      state.reload();
    } catch (err) {
      setBulkError(err);
    } finally {
      setBulkBusy(false);
    }
  };

  const okCount = results?.filter((r) => r.ok).length || 0;
  const failCount = results ? results.length - okCount : 0;
  const titleOf = (id) => rows.find((r) => r.id === id)?.title;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit queue</h1>
          <p className="page-sub">High-value claims at the auditor step and the random 10% sample of auto-approved claims.</p>
        </div>
      </div>

      <div className="row" role="group" aria-label="Queue type" style={{ marginBottom: 12 }}>
        {[['all', 'All'], ['auditor_step', 'Auditor step'], ['sample_audit', 'Sample audit']].map(([k, label]) => (
          <button key={k} type="button" className={`btn btn-sm ${filters.kind === k ? 'btn-primary' : ''}`} aria-pressed={filters.kind === k} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>

      <form className="card" onSubmit={apply} noValidate aria-labelledby="filters-h">
        <h2 id="filters-h" className="visually-hidden">Filters</h2>
        <div className="filters">
          <div className="field">
            <label htmlFor="f-q">Search</label>
            <input id="f-q" className="input" type="search" placeholder="Title, employee or claim #" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-dept">Department</label>
            <select id="f-dept" className="input" value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select id="f-cat" className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-flag">Policy flag</label>
            <select id="f-flag" className="input" value={draft.flag} onChange={(e) => setDraft({ ...draft, flag: e.target.value })}>
              <option value="">Any</option>
              {Object.entries(RULE_COPY).map(([k, v]) => <option key={k} value={k}>{v.short}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-min">Min total (₹)</label>
            <input id="f-min" className="input" inputMode="decimal" type="number" min="0" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })}
              aria-invalid={!!filterErr.min} aria-describedby={filterErr.min ? 'f-min-err' : undefined} />
            <FieldError id="f-min-err">{filterErr.min}</FieldError>
          </div>
          <div className="field">
            <label htmlFor="f-max">Max total (₹)</label>
            <input id="f-max" className="input" inputMode="decimal" type="number" min="0" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })}
              aria-invalid={!!filterErr.max} aria-describedby={filterErr.max ? 'f-max-err' : undefined} />
            <FieldError id="f-max-err">{filterErr.max}</FieldError>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={state.loading}>Apply</button>
            <button type="button" className="btn btn-ghost" onClick={reset}>Reset</button>
          </div>
        </div>
      </form>

      {results && (
        <section className={`alert ${failCount ? 'alert-warning' : 'alert-success'}`} role="status" aria-live="polite" aria-labelledby="bulk-h">
          <div className="alert-body">
            <strong id="bulk-h">Bulk approve finished: {okCount} approved{failCount ? `, ${failCount} not approved` : ''}.</strong>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {results.map((r) => (
                <li key={r.claim_id}>
                  <Link to={`/approvals/${r.claim_id}`}>#{r.claim_id}{titleOf(r.claim_id) ? ` ${titleOf(r.claim_id)}` : ''}</Link>{' '}
                  {r.ok
                    ? <span className="result-ok">✓ {STATUS[r.status]?.label || 'Approved'}</span>
                    : <span className="result-fail">✕ {r.error || 'Could not approve'}</span>}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResults(null)} aria-label="Dismiss results">✕</button>
        </section>
      )}

      <div className="toolbar" aria-live="polite">
        <span className="grow">
          {selected.size > 0
            ? <><strong>{selected.size}</strong> selected · {formatMoney(selectedTotal)}</>
            : <span className="muted">{rows.length} claim{rows.length === 1 ? '' : 's'} in queue. Select rows to approve in bulk.</span>}
        </span>
        <button type="button" className="btn btn-success" disabled={selected.size === 0 || bulkBusy} onClick={() => { setBulkError(null); setConfirming(true); }}>
          Bulk approve{selected.size ? ` (${selected.size})` : ''}
        </button>
      </div>

      <DataView
        state={state}
        loadingLabel="Loading audit queue…"
        isEmpty={(d) => !d.length}
        empty={<EmptyState icon="🔍" title="Nothing matches these filters">{JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS) ? 'The audit queue is empty. Claims above ₹25,000 and sampled claims show up here.' : 'Try widening the amount range or clearing filters.'}</EmptyState>}
      >
        {(data) => (
          <QueueTable rows={data} caption="Audit queue" selectable selected={selected} onToggle={toggle} onToggleAll={toggleAll} results={resultMap} />
        )}
      </DataView>
      <p className="muted small">Sample-audit claims are marked <span className="tag-sample">Sample audit</span>. Open one to clear or reject it individually, or include it in a bulk approve to clear it.</p>

      <ConfirmDialog open={confirming} title={`Approve ${selected.size} claim${selected.size === 1 ? '' : 's'}?`} confirmLabel="Approve all" tone="success"
        busy={bulkBusy} onConfirm={bulkApprove} onCancel={() => setConfirming(false)}>
        <p>Total {formatMoney(selectedTotal)}. Each claim moves to its next approval step, or to Approved if none are left.</p>
        {selectedSample > 0 && <p className="small" style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{selectedSample} sample-audit claim{selectedSample === 1 ? '' : 's'} selected. Bulk approve clears them from sample audit.</p>}
        <div className="field">
          <label htmlFor="bulk-comment">Comment (optional)</label>
          <input id="bulk-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        {bulkError && <ErrorState error={bulkError} title="Bulk approve failed" />}
      </ConfirmDialog>
    </>
  );
}
