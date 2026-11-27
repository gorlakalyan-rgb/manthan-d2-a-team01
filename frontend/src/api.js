// Thin fetch wrapper for the ExpenseFlow API (see CLAUDE.md "API contract").

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

// Friendly copy for machine codes the backend may send. Backend `detail` is used when no override exists.
const FRIENDLY = {
  NETWORK_ERROR: 'We could not reach the server. Check your connection and try again.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find that item. It may have been removed or you may not have access.',
  CONFLICT: 'Someone else updated this claim first. Refresh to see the latest status.',
  INVALID_TRANSITION: 'This action is no longer available for the claim in its current status. Refresh to see the latest.',
};

function messageFor(status, code, detail) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    // FastAPI validation error list
    return detail.map((d) => (d.loc ? `${d.loc.slice(1).join('.')}: ${d.msg}` : d.msg)).join('; ');
  }
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  if (status === 401) return FRIENDLY.UNAUTHENTICATED;
  if (status === 403) return FRIENDLY.FORBIDDEN;
  if (status === 404) return FRIENDLY.NOT_FOUND;
  if (status === 409) return FRIENDLY.CONFLICT;
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return `Request failed (${status}).`;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, query, signal, raw = false } = {}) {
  let url = path.startsWith('/') ? path : `/api/${path}`;
  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'ExpenseFlow';
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'include', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(FRIENDLY.NETWORK_ERROR);
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error */ }
    const code = data?.code || (res.status === 401 ? 'UNAUTHENTICATED' : `HTTP_${res.status}`);
    const err = new ApiError(messageFor(res.status, data?.code, data?.detail), { status: res.status, code, detail: data?.detail });
    if (res.status === 401 && onUnauthorized && !url.startsWith('/api/auth/')) onUnauthorized();
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const get = (path, query, opts) => api(path, { ...opts, query });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

export function uploadReceipt(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/api/receipts', { method: 'POST', body: fd });
}

/** Unwrap list responses that may arrive as an array or as {items|rows|claims|...: []}. */
export function asList(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of [...keys, 'items', 'rows', 'results', 'claims', 'data']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/* ---------------- Money ---------------- */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Format integer paise as ₹ (en-IN grouping). */
export function formatMoney(paise) {
  const n = Number(paise);
  if (!Number.isFinite(n)) return '—';
  return inr.format(n / 100);
}
export function formatMoneyShort(paise) {
  const n = Number(paise);
  if (!Number.isFinite(n)) return '—';
  return inrShort.format(Math.round(n / 100));
}
/** Convert rupees typed by the user into integer paise. Returns NaN for invalid input. */
export function rupeesToPaise(rupees) {
  if (rupees === '' || rupees === null || rupees === undefined) return NaN;
  const n = Number(String(rupees).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export function paiseToRupees(paise) {
  if (paise === null || paise === undefined || paise === '') return '';
  return String(Number(paise) / 100);
}

/* ---------------- Time (UTC stored, shown in IST) ---------------- */
const dtFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${dtFmt.format(d)} IST`;
}
/** Format a plain `date` (YYYY-MM-DD) without timezone shifting. */
export function formatDate(ymd) {
  if (!ymd) return '—';
  const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(ymd) : dFmt.format(d);
}
export function formatAge(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return '< 1h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
export function todayYmd() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/* ---------------- Labels ---------------- */
export const STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'info' },
  NEEDS_CLARIFICATION: { label: 'Needs clarification', tone: 'warning' },
  AUTO_REJECTED: { label: 'Auto-rejected', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  APPROVED: { label: 'Approved', tone: 'success' },
  SAMPLE_AUDIT: { label: 'Sample audit', tone: 'purple' },
  IN_PAYOUT: { label: 'In payout', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
};
export const STEP_LABEL = { MANAGER: 'Manager', AUDITOR: 'Finance auditor', HEAD: 'Finance head' };

export const CATEGORIES = ['meals', 'hotel', 'local_cab', 'airfare', 'train', 'office_supplies', 'internet', 'other'];
const CATEGORY_LABEL = {
  meals: 'Meals', hotel: 'Hotel', local_cab: 'Local cab', airfare: 'Airfare', train: 'Train',
  office_supplies: 'Office supplies', internet: 'Internet', other: 'Other',
};
export const categoryLabel = (c) => CATEGORY_LABEL[c] || humanize(c);

export const OUTCOME = {
  APPROVE: { label: 'Within policy', tone: 'success' },
  ROUTE: { label: 'Needs review', tone: 'warning' },
  REJECT: { label: 'Blocked', tone: 'danger' },
};

// Friendly fallback text for policy rule codes (used when the backend sends no message).
export const RULE_COPY = {
  MEAL_DAILY_LIMIT: { short: 'Meal limit', text: 'Over the daily meal limit, so a manager will review it.' },
  HOTEL_NIGHT_LIMIT_TIER1: { short: 'Hotel limit (tier-1)', text: 'Over the per-night hotel limit for a tier-1 city, so a manager will review it.' },
  HOTEL_NIGHT_LIMIT_OTHER: { short: 'Hotel limit', text: 'Over the per-night hotel limit, so a manager will review it.' },
  CAB_TRIP_LIMIT: { short: 'Cab limit', text: 'Over the per-trip cab limit, so a manager will review it.' },
  RECEIPT_REQUIRED_ABOVE: { short: 'Receipt needed', text: 'Receipt needed: lines above ₹500 must have a receipt.' },
  DUPLICATE_RECEIPT_HASH: { short: 'Duplicate receipt', text: 'This receipt file was already used on another claim. Please attach the correct receipt.' },
  DUPLICATE_VENDOR_AMOUNT_DATE: { short: 'Possible duplicate', text: 'Same vendor, amount and date as an earlier expense, so a manager will check it.' },
  WEEKEND_SPEND: { short: 'Weekend', text: 'Spent on a weekend, so a manager will confirm it was for work.' },
};
export const ruleShort = (code) => RULE_COPY[code]?.short || humanize(code);

export function humanize(s) {
  if (!s) return '';
  const t = String(s).replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
