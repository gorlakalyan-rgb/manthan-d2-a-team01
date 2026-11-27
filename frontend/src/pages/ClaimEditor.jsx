import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CATEGORIES, categoryLabel, formatMoney, get, paiseToRupees, post, put, rupeesToPaise, todayYmd, uploadReceipt,
} from '../api.js';
import { useAsync, useDocumentTitle } from '../hooks.js';
import { ErrorState, FieldError, Loading, StatusChip } from '../components/ui.jsx';

const MAX_PAISE = 100000000;
const RECEIPT_ABOVE = 50000;
const MAX_FILE = 5 * 1024 * 1024;
let keySeq = 0;
const newKey = () => `l${++keySeq}`;

const blankLine = () => ({
  key: newKey(), category: 'meals', amount: '', expense_date: todayYmd(), vendor: '', city: '', nights: '',
  description: '', receipt_id: null, receipt_name: '', uploading: false, uploadError: '',
});

function fromServer(l) {
  return {
    key: newKey(),
    category: l.category || 'other',
    amount: paiseToRupees(l.amount_paise),
    expense_date: (l.expense_date || '').slice(0, 10),
    vendor: l.vendor || '',
    city: l.city || '',
    nights: l.nights ?? '',
    description: l.description || '',
    receipt_id: l.receipt_id ?? null,
    receipt_name: l.receipt_filename || l.receipt?.filename || (l.receipt_id ? `Receipt #${l.receipt_id}` : ''),
    uploading: false,
    uploadError: '',
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function validate(title, lines) {
  const errs = { lines: {} };
  if (!title.trim()) errs.title = 'Give the claim a short title, e.g. “Client visit, Pune”.';
  if (!lines.length) errs.form = 'Add at least one expense line.';
  const today = todayYmd();
  const oldest = daysAgo(365);
  lines.forEach((l) => {
    const e = {};
    const p = rupeesToPaise(l.amount);
    if (l.amount === '' || Number.isNaN(p)) e.amount = 'Enter the amount in rupees.';
    else if (p <= 0) e.amount = 'Amount must be more than ₹0.';
    else if (p > MAX_PAISE) e.amount = 'Amount cannot be more than ₹10,00,000 per line.';
    if (!l.expense_date) e.expense_date = 'Pick the date of the expense.';
    else if (l.expense_date > today) e.expense_date = 'The date cannot be in the future.';
    else if (l.expense_date < oldest) e.expense_date = 'Expenses older than 365 days cannot be claimed.';
    if (!l.vendor.trim()) e.vendor = 'Enter who you paid (vendor).';
    if (l.category === 'hotel') {
      if (!l.city.trim()) e.city = 'Hotel lines need the city.';
      const n = Number(l.nights);
      if (!l.nights || !Number.isInteger(n) || n < 1) e.nights = 'Enter the number of nights (1 or more).';
    }
    if (l.uploading) e.receipt = 'Wait for the receipt to finish uploading.';
    if (Object.keys(e).length) errs.lines[l.key] = e;
  });
  const has = errs.title || errs.form || Object.keys(errs.lines).length;
  return has ? errs : null;
}

function toPayload(title, lines) {
  return {
    title: title.trim(),
    lines: lines.map((l) => ({
      category: l.category,
      amount_paise: rupeesToPaise(l.amount),
      expense_date: l.expense_date,
      vendor: l.vendor.trim(),
      city: l.category === 'hotel' ? l.city.trim() : (l.city.trim() || null),
      nights: l.category === 'hotel' ? Number(l.nights) : null,
      description: l.description.trim(),
      receipt_id: l.receipt_id,
    })),
  };
}

/** Map FastAPI 422 detail [{loc:[body,lines,0,amount_paise],msg}] to line field errors. */
function serverFieldErrors(err, lines) {
  if (!Array.isArray(err?.detail)) return null;
  const out = { lines: {} };
  err.detail.forEach((d) => {
    const loc = d.loc || [];
    const i = loc.indexOf('lines');
    if (i >= 0 && Number.isInteger(loc[i + 1]) && lines[loc[i + 1]]) {
      const key = lines[loc[i + 1]].key;
      let field = loc[i + 2] || 'form';
      if (field === 'amount_paise') field = 'amount';
      out.lines[key] = { ...(out.lines[key] || {}), [field]: d.msg };
    } else if (loc.includes('title')) out.title = d.msg;
  });
  return out;
}

export default function ClaimEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  useDocumentTitle(isNew ? 'New claim' : `Edit claim #${id}`);

  const meta = useAsync(() => get('/api/meta').catch(() => null), []);
  const detail = useAsync(() => (isNew ? Promise.resolve(null) : get(`/api/claims/${id}`)), [id]);

  const [title, setTitle] = useState('');
  const [lines, setLines] = useState(() => [blankLine()]);
  const [errors, setErrors] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'submit'
  const errorRef = useRef(null);
  const createdId = useRef(null);

  useEffect(() => {
    if (detail.data?.claim) {
      setTitle(detail.data.claim.title || '');
      const ls = (detail.data.lines || []).map(fromServer);
      setLines(ls.length ? ls : [blankLine()]);
    }
  }, [detail.data]);

  const categories = meta.data?.categories?.length ? meta.data.categories : CATEGORIES;
  const tier1 = meta.data?.tier1_cities || [];
  const total = useMemo(() => lines.reduce((s, l) => {
    const p = rupeesToPaise(l.amount);
    return s + (Number.isFinite(p) && p > 0 ? p : 0);
  }, 0), [lines]);

  if (!isNew && detail.loading && !detail.data) return <Loading label="Loading claim…" />;
  if (!isNew && detail.error && !detail.data) return <ErrorState error={detail.error} onRetry={detail.reload} title="Could not load this claim" />;

  const allowed = detail.data?.allowed_actions || ['edit', 'submit'];
  if (!isNew && detail.data && !allowed.includes('edit')) {
    return (
      <div className="card state" role="alert">
        <h1>This claim can’t be edited</h1>
        <p>Claims can be changed only while they are a draft, need clarification, or were auto-rejected.</p>
        <Link className="btn btn-primary" to={`/claims/${id}`}>View claim</Link>
      </div>
    );
  }

  const update = (key, patch) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setSaved('');
  };
  const addLine = () => {
    const l = blankLine();
    setLines((ls) => [...ls, l]);
    setTimeout(() => document.getElementById(`cat-${l.key}`)?.focus(), 0);
  };
  const removeLine = (key, idx) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setTimeout(() => {
      const target = document.querySelectorAll('.line-card select')[Math.max(0, idx - 1)];
      (target || document.getElementById('add-line'))?.focus();
    }, 0);
  };

  const onFile = async (key, file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      update(key, { uploadError: 'Receipts must be a JPG, PNG or PDF file.' });
      return;
    }
    if (file.size > MAX_FILE) {
      update(key, { uploadError: 'That file is larger than 5 MB. Please upload a smaller scan or photo.' });
      return;
    }
    update(key, { uploading: true, uploadError: '' });
    try {
      const r = await uploadReceipt(file);
      update(key, { uploading: false, receipt_id: r.id, receipt_name: r.filename || file.name });
    } catch (err) {
      update(key, { uploading: false, uploadError: err.message });
    }
  };

  const focusFirstError = () => setTimeout(() => {
    const el = document.querySelector('[aria-invalid="true"]') || errorRef.current;
    el?.focus();
  }, 0);

  const persist = async () => {
    let claimId = id || createdId.current;
    if (!claimId) {
      const created = await post('/api/claims', { title: title.trim() });
      claimId = created?.id ?? created?.claim?.id;
      createdId.current = claimId;
    }
    const res = await put(`/api/claims/${claimId}`, toPayload(title, lines));
    return { claimId, res };
  };

  const run = async (mode) => {
    const errs = validate(title, lines);
    setErrors(errs);
    setFormError(null);
    setSaved('');
    if (errs) { focusFirstError(); return; }
    setBusy(mode);
    try {
      const out = await persist();
      const claimId = out.claimId;
      if (mode === 'save') {
        setSaved('Draft saved. You can come back and finish it any time.');
        if (isNew) navigate(`/claims/${claimId}/edit`, { replace: true });
        else if (out.res?.lines) detail.setData(out.res);
      } else {
        const result = await post(`/api/claims/${claimId}/submit`);
        navigate(`/claims/${claimId}`, { state: { submitted: result?.claim?.status || true } });
      }
    } catch (err) {
      const fe = serverFieldErrors(err, lines);
      if (fe && (fe.title || Object.keys(fe.lines).length)) setErrors(fe);
      setFormError(err);
      focusFirstError();
    } finally {
      setBusy(null);
    }
  };

  const lineErr = (key) => errors?.lines?.[key] || {};
  const status = detail.data?.claim?.status;

  return (
    <form onSubmit={(e) => { e.preventDefault(); run('submit'); }} noValidate aria-busy={!!busy}>
      <div className="page-head">
        <div>
          <h1>{isNew ? 'New claim' : `Edit claim #${id}`}</h1>
          <p className="page-sub">Add one line per expense. Lines above ₹500 need a receipt.</p>
        </div>
        {status && <StatusChip status={status} step={detail.data?.claim?.current_step} />}
      </div>

      {status === 'NEEDS_CLARIFICATION' && (
        <div className="alert alert-warning" role="status"><div className="alert-body"><strong>Your approver asked for clarification.</strong> Check their comment on the claim page, update the lines, then submit again.</div></div>
      )}
      {status === 'AUTO_REJECTED' && (
        <div className="alert alert-warning" role="status"><div className="alert-body"><strong>This claim was blocked by policy.</strong> Fix the lines marked on the claim page (for example, attach missing receipts), then submit again.</div></div>
      )}

      <div ref={errorRef} tabIndex={-1}>
        {formError && <ErrorState error={formError} title={busy === 'submit' ? 'Could not submit' : 'Could not save the claim'} />}
        {errors?.form && <div role="alert" className="alert alert-error"><div className="alert-body">{errors.form}</div></div>}
        {errors && !formError && !errors.form && (
          <div role="alert" className="alert alert-error"><div className="alert-body"><strong>Please fix the highlighted fields.</strong></div></div>
        )}
      </div>
      {saved && <div role="status" aria-live="polite" className="alert alert-success"><div className="alert-body">{saved}</div></div>}

      <div className="card">
        <div className="field">
          <label htmlFor="claim-title">Claim title</label>
          <input id="claim-title" className="input" value={title} maxLength={200} placeholder="e.g. Client visit, Pune"
            onChange={(e) => { setTitle(e.target.value); setSaved(''); }}
            aria-invalid={!!errors?.title} aria-describedby={errors?.title ? 'title-err' : undefined} />
          <FieldError id="title-err">{errors?.title}</FieldError>
        </div>
      </div>

      <h2>Expense lines <span className="muted small">({lines.length})</span></h2>
      {lines.map((l, idx) => {
        const e = lineErr(l.key);
        const p = rupeesToPaise(l.amount);
        const needsReceipt = Number.isFinite(p) && p > RECEIPT_ABOVE && !l.receipt_id;
        const isHotel = l.category === 'hotel';
        const fid = (f) => `${f}-${l.key}`;
        return (
          <section key={l.key} className="line-card" aria-labelledby={`h-${l.key}`}>
            <div className="line-head">
              <h3 id={`h-${l.key}`}>Line {idx + 1}{Number.isFinite(p) && p > 0 ? ` · ${formatMoney(p)}` : ''}</h3>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeLine(l.key, idx)}
                disabled={lines.length === 1} aria-label={`Remove line ${idx + 1}`}>Remove</button>
            </div>
            <div className="grid-form cols-4">
              <div className="field">
                <label htmlFor={fid('cat')}>Category</label>
                <select id={fid('cat')} className="input" value={l.category} onChange={(ev) => update(l.key, { category: ev.target.value })}>
                  {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={fid('amt')}>Amount (₹)</label>
                <div className="input-prefix">
                  <span aria-hidden="true">₹</span>
                  <input id={fid('amt')} className="input" inputMode="decimal" type="number" min="0.01" step="0.01" value={l.amount}
                    onChange={(ev) => update(l.key, { amount: ev.target.value })}
                    aria-invalid={!!e.amount} aria-describedby={e.amount ? `${fid('amt')}-err` : undefined} />
                </div>
                <FieldError id={`${fid('amt')}-err`}>{e.amount}</FieldError>
              </div>
              <div className="field">
                <label htmlFor={fid('date')}>Date</label>
                <input id={fid('date')} className="input" type="date" max={todayYmd()} min={daysAgo(365)} value={l.expense_date}
                  onChange={(ev) => update(l.key, { expense_date: ev.target.value })}
                  aria-invalid={!!e.expense_date} aria-describedby={e.expense_date ? `${fid('date')}-err` : undefined} />
                <FieldError id={`${fid('date')}-err`}>{e.expense_date}</FieldError>
              </div>
              <div className="field">
                <label htmlFor={fid('vendor')}>Vendor</label>
                <input id={fid('vendor')} className="input" value={l.vendor} maxLength={200} placeholder="e.g. Taj Hotels"
                  onChange={(ev) => update(l.key, { vendor: ev.target.value })}
                  aria-invalid={!!e.vendor} aria-describedby={e.vendor ? `${fid('vendor')}-err` : undefined} />
                <FieldError id={`${fid('vendor')}-err`}>{e.vendor}</FieldError>
              </div>
              {isHotel && (
                <>
                  <div className="field">
                    <label htmlFor={fid('city')}>City</label>
                    <input id={fid('city')} className="input" value={l.city} list="tier1-cities" placeholder="e.g. Mumbai"
                      onChange={(ev) => update(l.key, { city: ev.target.value })}
                      aria-invalid={!!e.city} aria-describedby={`${fid('city')}-hint${e.city ? ` ${fid('city')}-err` : ''}`} />
                    <span className="hint" id={`${fid('city')}-hint`}>Tier-1 cities have a higher nightly limit.</span>
                    <FieldError id={`${fid('city')}-err`}>{e.city}</FieldError>
                  </div>
                  <div className="field">
                    <label htmlFor={fid('nights')}>Nights</label>
                    <input id={fid('nights')} className="input" type="number" inputMode="numeric" min="1" step="1" value={l.nights}
                      onChange={(ev) => update(l.key, { nights: ev.target.value })}
                      aria-invalid={!!e.nights} aria-describedby={e.nights ? `${fid('nights')}-err` : undefined} />
                    <FieldError id={`${fid('nights')}-err`}>{e.nights}</FieldError>
                  </div>
                </>
              )}
              <div className="field span-all">
                <label htmlFor={fid('desc')}>Description <span className="muted">(optional)</span></label>
                <input id={fid('desc')} className="input" value={l.description} maxLength={500} placeholder="What was it for?"
                  onChange={(ev) => update(l.key, { description: ev.target.value })} />
              </div>
              <div className="field span-all">
                <span className="label" id={`${fid('rcpt')}-label`}>Receipt</span>
                <div className="receipt-box">
                  {l.receipt_id && (
                    <span className="file-pill"><span aria-hidden="true">📎</span> {l.receipt_name || 'Receipt attached'}</span>
                  )}
                  <label className="btn btn-sm" htmlFor={fid('file')} style={{ cursor: l.uploading ? 'wait' : 'pointer' }}>
                    {l.uploading ? 'Uploading…' : l.receipt_id ? 'Replace receipt' : 'Upload receipt'}
                  </label>
                  <input id={fid('file')} type="file" accept="image/jpeg,image/png,application/pdf" className="visually-hidden"
                    disabled={l.uploading} aria-describedby={`${fid('rcpt')}-label ${fid('rcpt')}-hint`}
                    onChange={(ev) => { onFile(l.key, ev.target.files?.[0]); ev.target.value = ''; }} />
                  {l.receipt_id && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => update(l.key, { receipt_id: null, receipt_name: '' })}>
                      Remove receipt
                    </button>
                  )}
                  {l.uploading && <span role="status" aria-live="polite" className="small"><span className="spinner" aria-hidden="true" /> Uploading…</span>}
                </div>
                <span className="hint" id={`${fid('rcpt')}-hint`}>JPG, PNG or PDF, up to 5 MB.</span>
                <FieldError id={`${fid('file')}-err`}>{l.uploadError || e.receipt}</FieldError>
                {needsReceipt && !l.uploadError && (
                  <span className="small" role="note" style={{ color: 'var(--color-warning)', fontWeight: 600 }}>
                    Receipt needed: lines above ₹500 must have a receipt, or the claim will be blocked when you submit.
                  </span>
                )}
              </div>
            </div>
          </section>
        );
      })}
      <datalist id="tier1-cities">{tier1.map((c) => <option key={c} value={c} />)}</datalist>

      <button type="button" id="add-line" className="btn" onClick={addLine}>+ Add another line</button>

      <div className="sticky-bar">
        <div>
          <div className="total-label">Claim total</div>
          <div className="total-value" aria-live="polite">{formatMoney(total)}</div>
        </div>
        <div className="actions">
          <Link to={isNew ? '/claims' : `/claims/${id}`} className="btn btn-ghost">Cancel</Link>
          <button type="button" className="btn" onClick={() => run('save')} disabled={!!busy} aria-busy={busy === 'save' || undefined}>
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!busy} aria-busy={busy === 'submit' || undefined}>
            {busy === 'submit' ? 'Submitting…' : 'Submit claim'}
          </button>
        </div>
      </div>
    </form>
  );
}
