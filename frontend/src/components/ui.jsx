import { useEffect, useRef } from 'react';
import { OUTCOME, STATUS, STEP_LABEL, ruleShort, humanize } from '../api.js';

export function StatusChip({ status, step }) {
  const s = STATUS[status] || { label: humanize(status), tone: 'neutral' };
  const stepText = status === 'PENDING_APPROVAL' && step ? ` · ${STEP_LABEL[step] || humanize(step)}` : '';
  return <span className={`chip chip-${s.tone}`}>{s.label}{stepText}</span>;
}

export function OutcomeBadge({ outcome }) {
  const o = OUTCOME[outcome];
  if (!o) return null;
  return <span className={`chip chip-${o.tone}`}>{o.label}</span>;
}

/** Normalise flags: array of strings, array of {code}, or object map. */
// eslint-disable-next-line react-refresh/only-export-components
export function flagCodes(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags.map((f) => (typeof f === 'string' ? f : f?.code || f?.rule || '')).filter(Boolean);
  if (typeof flags === 'object') return Object.keys(flags).filter((k) => flags[k]);
  return [];
}

export function Flags({ flags, empty = 'None' }) {
  const codes = [...new Set(flagCodes(flags))];
  if (!codes.length) return <span className="muted small">{empty}</span>;
  return (
    <span className="flags">
      {codes.map((c) => {
        const danger = c === 'RECEIPT_REQUIRED_ABOVE' || c === 'DUPLICATE_RECEIPT_HASH';
        return <span key={c} className={`chip ${danger ? 'chip-danger' : 'chip-warning'}`} title={c}>{ruleShort(c)}</span>;
      })}
    </span>
  );
}

export function Loading({ label = 'Loading…', rows = 3 }) {
  return (
    <div role="status" aria-live="polite" className="card">
      <span className="spinner" aria-hidden="true" /> <span>{label}</span>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} aria-hidden="true" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div role="alert" className="alert alert-error">
      <div className="alert-body">
        <strong>{title}</strong>
        <p style={{ margin: '4px 0 0' }}>{error?.message || String(error)}</p>
      </div>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ icon = '📭', title, children, action }) {
  return (
    <div className="card state">
      <span className="state-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Renders loading / error / empty / content for a useAsync result. */
export function DataView({ state, isEmpty, empty, loadingLabel, children }) {
  const { data, error, loading, reload } = state;
  if (loading && data == null) return <Loading label={loadingLabel} />;
  if (error && data == null) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      {error && <ErrorState error={error} onRetry={reload} title="Could not refresh" />}
      {loading && <p role="status" aria-live="polite" className="muted small"><span className="spinner" aria-hidden="true" /> Refreshing…</p>}
      {isEmpty?.(data) ? empty : children(data)}
    </>
  );
}

export function Notice({ kind = 'success', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className="alert-body">{children}</div>
      {onClose && <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Dismiss message">✕</button>}
    </div>
  );
}

export function FieldError({ id, children }) {
  if (!children) return null;
  return <span id={id} className="field-error">{children}</span>;
}

/** Accessible confirm dialog built on <dialog>. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'primary', busy, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      <div>{children}</div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
