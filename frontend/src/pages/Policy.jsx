import { useState } from 'react';
import { OUTCOME, asList, formatMoney, get, humanize, put, rupeesToPaise } from '../api.js';
import { roleCaps, useAuth } from '../auth.jsx';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { DataView, EmptyState, FieldError, Notice } from '../components/ui.jsx';

const MONEY_CODES = new Set([
  'MEAL_DAILY_LIMIT', 'HOTEL_NIGHT_LIMIT_TIER1', 'HOTEL_NIGHT_LIMIT_OTHER', 'CAB_TRIP_LIMIT',
  'RECEIPT_REQUIRED_ABOVE', 'AUTO_APPROVE_MAX_TOTAL', 'AUDITOR_THRESHOLD', 'HEAD_THRESHOLD',
]);
const PERCENT_CODES = new Set(['SAMPLE_AUDIT_PERCENT']);

function kindOf(rule) {
  if (MONEY_CODES.has(rule.code)) return 'money';
  if (PERCENT_CODES.has(rule.code)) return 'percent';
  if (typeof rule.value === 'number') return 'number';
  if (rule.value === null || rule.value === undefined) return 'none';
  return 'json';
}

function display(rule) {
  const k = kindOf(rule);
  if (k === 'money') return formatMoney(rule.value);
  if (k === 'percent') return `${rule.value}%`;
  if (k === 'none') return '—';
  if (Array.isArray(rule.value)) return rule.value.join(', ');
  return typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value);
}

function toInput(rule) {
  const k = kindOf(rule);
  if (k === 'money') return String(Number(rule.value) / 100);
  if (k === 'json') return Array.isArray(rule.value) ? rule.value.join(', ') : JSON.stringify(rule.value);
  return String(rule.value ?? '');
}

function parseInput(rule, text) {
  const k = kindOf(rule);
  if (k === 'money') {
    const p = rupeesToPaise(text);
    if (Number.isNaN(p) || p < 0) throw new Error('Enter a rupee amount of ₹0 or more.');
    return p;
  }
  if (k === 'percent' || k === 'number') {
    const n = Number(text);
    if (text === '' || !Number.isInteger(n) || n < 0) throw new Error('Enter a whole number of 0 or more.');
    if (k === 'percent' && n > 100) throw new Error('A percentage cannot be more than 100.');
    return n;
  }
  if (Array.isArray(rule.value)) {
    const items = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.length) throw new Error('Enter at least one value, separated by commas.');
    return items;
  }
  try { return JSON.parse(text); } catch { throw new Error('This value must be valid JSON.'); }
}

export default function Policy() {
  useDocumentTitle('Policy');
  const { user } = useAuth();
  const canEdit = roleCaps(user).isHead;
  const state = useAsync(() => get('/api/policy').then((d) => asList(d, 'rules')), []);
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const start = (rule) => { setEditing(rule.code); setValue(toInput(rule)); setErr(''); setNotice(''); };
  const cancel = () => { setEditing(null); setErr(''); };
  const save = async (rule) => {
    let parsed;
    try { parsed = parseInput(rule, value.trim()); } catch (e) { setErr(e.message); return; }
    setBusy(true);
    setErr('');
    try {
      const updated = await put(`/api/policy/${encodeURIComponent(rule.code)}`, { value: parsed });
      const next = updated?.rule || updated;
      state.setData((state.data || []).map((r) => (r.code === rule.code ? { ...r, ...(next && next.code ? next : { value: parsed }) } : r)));
      setNotice(`${humanize(rule.code)} updated. New submissions use the new value; the change is recorded in the audit log.`);
      setEditing(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expense policy</h1>
          <p className="page-sub">
            Every claim line is checked against these rules when it is submitted.
            {canEdit ? ' As finance head you can change values; every change is audited.' : ' Only the finance head can change them.'}
          </p>
        </div>
      </div>
      <Notice onClose={() => setNotice('')}>{notice}</Notice>
      <DataView state={state} loadingLabel="Loading policy rules…" isEmpty={(d) => !d.length}
        empty={<EmptyState icon="📘" title="No policy rules found">The policy table is empty. Seed the database to load the default rules.</EmptyState>}>
        {(rules) => (
          <div className="table-wrap">
            <table className="data responsive">
              <caption className="visually-hidden">Policy rules</caption>
              <thead><tr><th scope="col">Rule</th><th scope="col">Value</th><th scope="col">When broken</th>{canEdit && <th scope="col"><span className="visually-hidden">Actions</span></th>}</tr></thead>
              <tbody>
                {rules.map((r) => {
                  const o = OUTCOME[r.outcome];
                  const isEditing = editing === r.code;
                  const inputId = `pv-${r.code}`;
                  const k = kindOf(r);
                  return (
                    <tr key={r.code}>
                      <td data-label="Rule">
                        <span className="cell-strong">{humanize(r.code)}</span>
                        <span className="cell-sub mono">{r.code}</span>
                        {r.description && <span className="cell-sub">{r.description}</span>}
                      </td>
                      <td data-label="Value">
                        {isEditing ? (
                          <form className="field" onSubmit={(e) => { e.preventDefault(); save(r); }} noValidate>
                            <label htmlFor={inputId} className="visually-hidden">New value for {humanize(r.code)}{k === 'money' ? ' in rupees' : ''}</label>
                            <div className={k === 'money' ? 'input-prefix' : undefined}>
                              {k === 'money' && <span aria-hidden="true">₹</span>}
                              <input id={inputId} className="input" value={value} autoFocus inputMode={k === 'json' ? 'text' : 'decimal'}
                                onChange={(e) => { setValue(e.target.value); setErr(''); }}
                                aria-invalid={!!err} aria-describedby={err ? `${inputId}-err` : undefined} />
                            </div>
                            {k === 'json' && Array.isArray(r.value) && <span className="hint">Separate values with commas.</span>}
                            <FieldError id={`${inputId}-err`}>{err}</FieldError>
                            <div className="row">
                              <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save'}</button>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
                            </div>
                          </form>
                        ) : <span className="cell-strong">{display(r)}</span>}
                      </td>
                      <td data-label="When broken">{o ? <span className={`chip chip-${o.tone}`}>{r.outcome === 'REJECT' ? 'Auto-reject' : r.outcome === 'ROUTE' ? 'Route to approver' : o.label}</span> : <span className="muted">Setting</span>}</td>
                      {canEdit && (
                        <td data-label="Actions">
                          {!isEditing && <button type="button" className="btn btn-sm" onClick={() => start(r)} disabled={!!editing}>Edit<span className="visually-hidden"> {humanize(r.code)}</span></button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataView>
    </>
  );
}
