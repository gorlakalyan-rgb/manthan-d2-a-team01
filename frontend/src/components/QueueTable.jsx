import { Link } from 'react-router-dom';
import { formatAge, formatMoney } from '../api.js';
import { Flags, StatusChip } from './ui.jsx';
import { Avatar } from './brand.jsx';

/**
 * Dense, scannable claims table for approval inbox and audit queue.
 * Optional selection (Set of ids) and per-row bulk results (map id → {ok,status,error}).
 */
export default function QueueTable({ rows, caption, selectable, selected, onToggle, onToggleAll, results, linkBase = '/approvals' }) {
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selectable && rows.some((r) => selected.has(r.id));
  return (
    <div className="table-wrap">
      <table className="data responsive">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="check-cell">
                <label>
                  <input type="checkbox" className="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={(e) => onToggleAll(e.target.checked)} />
                  <span className="visually-hidden">Select all {rows.length} rows</span>
                </label>
              </th>
            )}
            <th scope="col">Claim</th>
            <th scope="col">Employee</th>
            <th scope="col">Department</th>
            <th scope="col" className="num">Total</th>
            <th scope="col">Flags</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Age</th>
            {results && <th scope="col">Result</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const res = results?.[r.id];
            const isSample = r.status === 'SAMPLE_AUDIT' || r.kind === 'sample_audit';
            return (
              <tr key={r.id} className={selectable && selected.has(r.id) ? 'selected' : undefined}>
                {selectable && (
                  <td className="check-cell">
                    <label>
                      <input type="checkbox" className="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} />
                      <span className="visually-hidden">Select claim #{r.id} {r.title}</span>
                    </label>
                  </td>
                )}
                <td data-label="Claim" style={{ minWidth: 190 }}>
                  <Link to={`${linkBase}/${r.id}`} className="cell-strong">#{r.id} {r.title}</Link>
                  {isSample && <> <span className="tag-sample">Sample audit</span></>}
                </td>
                <td data-label="Employee"><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar name={r.employee_name || r.employee?.name || '?'} size={26} /><span>{r.employee_name || r.employee?.name || '—'}</span></span></td>
                <td data-label="Department">{r.department || r.department_name || '—'}</td>
                <td data-label="Total" className="num cell-strong">{formatMoney(r.total_paise)}</td>
                <td data-label="Flags"><Flags flags={r.flags} empty="Clean" /></td>
                <td data-label="Status"><StatusChip status={r.status} step={r.current_step} /></td>
                <td data-label="Age" className="num"><span className={`chip chip-plain ${Number(r.age_hours) > 48 ? 'chip-danger' : Number(r.age_hours) > 24 ? 'chip-warning' : 'chip-neutral'}`}>{formatAge(r.age_hours)}</span></td>
                {results && (
                  <td data-label="Result" aria-live="polite">
                    {res ? (res.ok
                      ? <span className="result-ok">✓ {res.status ? res.status.replace(/_/g, ' ').toLowerCase() : 'done'}</span>
                      : <span className="result-fail">✕ {res.error || 'Failed'}</span>) : <span className="muted">—</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
