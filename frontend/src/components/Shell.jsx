import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  Banknote, Bell, ChevronsLeft, ChevronsRight, CircleHelp, FilePlus2, History, Inbox, Keyboard, LayoutDashboard,
  LogOut, Moon, Palette, Receipt, Scale, Search, Settings, ShieldCheck, Sun, User, UserCog, Users, WifiOff, ArrowRight, Hash,
  CornerDownLeft, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { roleCaps, useAuth } from '../auth.jsx';
import { asList, formatAge, formatMoney, get, humanize } from '../api.js';
import { ACCENTS, useSettings } from '../settings.jsx';
import { AppIcon, Avatar, Wordmark } from './brand.jsx';

/* ------------------------------------------------------------------ navigation model */
export function navFor(user) {
  const c = roleCaps(user);
  return [
    { section: 'Workspace' },
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: c.isAuditor, key: 'd' },
    { to: '/claims', label: 'My claims', icon: Receipt, show: true, badge: 'mine', key: 'c' },
    { to: '/approvals', label: 'Approvals', icon: Inbox, show: c.isApprover, badge: 'inbox', key: 'a' },
    { to: '/audit', label: 'Audit queue', icon: ShieldCheck, show: c.isAuditor, badge: 'audit', key: 'q' },
    { to: '/employees', label: 'Employee details', icon: Users, show: c.isApprover, key: 'e' },
    { section: 'Finance' },
    { to: '/payouts', label: 'Payouts', icon: Banknote, show: c.isHead, key: 'p' },
    { to: '/policy', label: 'Policy', icon: Scale, show: true, key: 'l' },
    { to: '/activity', label: 'Audit trail', icon: History, show: c.isAuditor, key: 't' },
    { section: 'Account' },
    { to: '/delegations', label: 'Delegation', icon: UserCog, show: c.canDelegate },
    { to: '/profile', label: 'Profile', icon: User, show: true, key: 'u' },
    { to: '/settings', label: 'Settings', icon: Settings, show: true, key: 's' },
  ].filter((l) => l.section || l.show);
}

/* ------------------------------------------------------------------ live counts + notifications */
function useLiveData(user) {
  const caps = roleCaps(user);
  const { pathname } = useLocation();
  const [data, setData] = useState({ inbox: [], audit: [], mine: [], log: [] });
  const load = useCallback(async () => {
    const [inbox, audit, mine, log] = await Promise.all([
      caps.isApprover ? get('/api/approvals/inbox').catch(() => []) : [],
      caps.isAuditor ? get('/api/audit/queue').catch(() => []) : [],
      get('/api/claims').catch(() => []),
      caps.isAuditor ? get('/api/audit-log', { limit: 12 }).catch(() => []) : [],
    ]);
    setData({ inbox: asList(inbox), audit: asList(audit), mine: asList(mine), log: asList(log) });
  }, [caps.isApprover, caps.isAuditor]);
  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const counts = {
    inbox: data.inbox.length,
    audit: data.audit.length,
    mine: data.mine.filter((c) => c.status === 'NEEDS_CLARIFICATION').length,
  };
  return { ...data, counts };
}

function useHealth() {
  const [online, setOnline] = useState(navigator.onLine);
  const [api, setApi] = useState('ok');
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const ping = () => fetch('/healthz').then((r) => r.json()).then((j) => setApi(j.status === 'ok' ? 'ok' : 'degraded')).catch(() => setApi('down'));
    ping();
    const t = setInterval(ping, 30000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, []);
  return { online, api };
}

/* ------------------------------------------------------------------ command palette */
function CommandPalette({ open, onClose, user, live, onShortcuts }) {
  const navigate = useNavigate();
  const { set, toggleTheme, settings, resolved } = useSettings();
  const { logout } = useAuth();
  const caps = roleCaps(user);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  const items = useMemo(() => {
    const go = (to) => () => navigate(to);
    const list = [];
    const num = q.trim().replace(/^#/, '');
    if (/^\d+$/.test(num)) {
      list.push({ group: 'Jump to', label: `Open claim #${num}`, icon: Hash, run: go(caps.isApprover ? `/approvals/${num}` : `/claims/${num}`) });
    }
    navFor(user).filter((n) => n.to).forEach((n) => list.push({ group: 'Go to', label: n.label, icon: n.icon, run: go(n.to), hint: n.key ? `G then ${n.key.toUpperCase()}` : '' }));
    list.push({ group: 'Actions', label: 'File a new claim', icon: FilePlus2, run: go('/claims/new'), hint: 'N' });
    list.push({ group: 'Actions', label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: resolved === 'dark' ? Sun : Moon, run: () => toggleTheme(), hint: 'T' });
    ACCENTS.forEach((a) => list.push({ group: 'Themes', label: `Theme: ${a.name}`, icon: Palette, run: () => set({ accent: a.id }), hint: settings.accent === a.id ? 'Current' : '' }));
    list.push({ group: 'Actions', label: settings.collapsed ? 'Expand sidebar' : 'Collapse sidebar', icon: settings.collapsed ? ChevronsRight : ChevronsLeft, run: () => set({ collapsed: !settings.collapsed }), hint: '[' });
    list.push({ group: 'Actions', label: 'Keyboard shortcuts', icon: Keyboard, run: onShortcuts, hint: '?' });
    live.inbox.slice(0, 6).forEach((c) => list.push({ group: 'Waiting for you', label: `#${c.id} · ${c.title}`, sub: `${c.employee_name} · ${formatMoney(c.total_paise)}`, icon: Inbox, run: go(`/approvals/${c.id}`) }));
    live.mine.slice(0, 6).forEach((c) => list.push({ group: 'My recent claims', label: `#${c.id} · ${c.title}`, sub: humanize(c.status), icon: Receipt, run: go(`/claims/${c.id}`) }));
    list.push({ group: 'Account', label: 'Sign out', icon: LogOut, run: async () => { await logout(); navigate('/login'); } });
    const needle = q.trim().toLowerCase();
    return needle && !/^#?\d+$/.test(needle)
      ? list.filter((i) => `${i.label} ${i.sub || ''} ${i.group}`.toLowerCase().includes(needle))
      : list;
  }, [q, user, live, caps.isApprover, navigate, resolved, toggleTheme, set, settings.accent, settings.collapsed, onShortcuts, logout]);

  useEffect(() => { setSel(0); }, [q]);

  const run = (i) => { const it = items[i]; if (!it) return; onClose(); it.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  useEffect(() => { document.getElementById(`cmd-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  let lastGroup = null;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
          <motion.div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.97, y: -8, x: '-50%' }} animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, scale: 0.98, x: '-50%' }} transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="cmdk-input">
              <Search aria-hidden="true" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search pages, claims (#1234), actions, themes…"
                role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={`cmd-${sel}`} aria-label="Command" />
              <span className="kbd">Esc</span>
            </div>
            <div className="cmdk-list" id="cmdk-list" role="listbox">
              {items.length === 0 && <p className="muted small" style={{ padding: 16, textAlign: 'center' }}>No matches. Try a page name or a claim number.</p>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? <div className="cmdk-group" key={`g-${it.group}`}>{it.group}</div> : null;
                lastGroup = it.group;
                const Icon = it.icon;
                return [header, (
                  <div key={`${it.group}-${it.label}`} id={`cmd-${i}`} role="option" aria-selected={sel === i} className="cmdk-item"
                    onPointerMove={() => setSel(i)} onClick={() => run(i)}>
                    <Icon aria-hidden="true" />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                      {it.sub && <span className="small muted">{it.sub}</span>}
                    </span>
                    {it.hint ? <span className="hint">{it.hint}</span> : sel === i ? <ArrowRight className="hint" aria-hidden="true" style={{ marginLeft: 'auto' }} /> : null}
                  </div>
                )];
              })}
            </div>
            <div className="cmdk-foot">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> Navigate</span>
              <span><span className="kbd"><CornerDownLeft size={11} /></span> Open</span>
              <span style={{ marginLeft: 'auto' }}>Type a number to jump to a claim</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ notifications */
function NotificationSheet({ open, onClose, live, user }) {
  const caps = roleCaps(user);
  const { settings } = useSettings();
  const items = [
    ...(settings.notifySentBack ? live.mine : []).filter((c) => c.status === 'NEEDS_CLARIFICATION').map((c) => ({
      key: `sb-${c.id}`, to: `/claims/${c.id}`, tone: 'warning', icon: AlertTriangle, title: `Claim #${c.id} was sent back`, body: `${c.title} needs your clarification.`,
    })),
    ...(settings.notifyApprovals ? live.inbox : []).slice(0, 8).map((c) => ({
      key: `in-${c.id}`, to: `/approvals/${c.id}`, tone: 'brand', icon: Inbox, title: `${c.employee_name} · ${formatMoney(c.total_paise)}`, body: `#${c.id} ${c.title} · waiting ${formatAge(c.age_hours)}`,
    })),
    ...(settings.notifyPayouts ? live.mine : []).filter((c) => c.status === 'PAID').slice(0, 3).map((c) => ({
      key: `pd-${c.id}`, to: `/claims/${c.id}`, tone: 'success', icon: CheckCircle2, title: `Claim #${c.id} was paid`, body: `${c.title} · ${formatMoney(c.total_paise)}`,
    })),
    ...(caps.isAuditor ? live.log.filter((e) => e.entity === 'claim').slice(0, 5).map((e) => ({
      key: `lg-${e.id}`, to: `/activity`, tone: 'neutral', icon: History, title: `${e.actor_name || 'System'} · ${humanize(e.action)}`, body: `Claim #${e.entity_id}${e.to_status ? ` → ${humanize(e.to_status)}` : ''}`,
    })) : []),
  ];
  const toneBg = { warning: 'var(--color-warning-soft)', brand: 'var(--color-primary-soft)', success: 'var(--color-success-soft)', neutral: 'var(--color-surface-3)' };
  const toneFg = { warning: 'var(--color-warning)', brand: 'var(--color-primary)', success: 'var(--color-success)', neutral: 'var(--color-text-muted)' };

  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="notif-h"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
            <div className="sheet-head">
              <div>
                <h2 id="notif-h">Notifications</h2>
                <span className="small muted">{items.length} item{items.length === 1 ? '' : 's'} need your attention</span>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close notifications" autoFocus>✕</button>
            </div>
            <div className="sheet-body">
              {items.length === 0 && (
                <div className="state"><span className="state-icon"><Bell /></span><h3>You’re all caught up</h3><p>New approvals and updates will show up here.</p></div>
              )}
              {items.map((n, i) => (
                <motion.div key={n.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <NavLink to={n.to} className="notif" onClick={onClose}>
                    <span className="notif-icon" style={{ background: toneBg[n.tone], color: toneFg[n.tone] }}><n.icon aria-hidden="true" /></span>
                    <span style={{ minWidth: 0 }}><b>{n.title}</b><span>{n.body}</span></span>
                  </NavLink>
                </motion.div>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ shortcuts dialog */
export const SHORTCUTS = [
  ['Open command palette', ['Ctrl', 'K']],
  ['Show this list', ['?']],
  ['New claim', ['N']],
  ['Toggle dark mode', ['T']],
  ['Collapse sidebar', ['[']],
  ['Go to dashboard', ['G', 'D']],
  ['Go to my claims', ['G', 'C']],
  ['Go to approvals', ['G', 'A']],
  ['Go to audit queue', ['G', 'Q']],
  ['Go to employee details', ['G', 'E']],
  ['Go to settings', ['G', 'S']],
  ['Review: approve', ['A']],
  ['Review: send back', ['S']],
  ['Review: reject', ['R']],
  ['Review: next / previous line', ['J', 'K']],
  ['Review: back to inbox', ['Esc']],
];
function ShortcutsDialog({ open, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="sc-h" onCancel={(e) => { e.preventDefault(); onClose(); }} style={{ maxWidth: 'min(720px, calc(100vw - 32px))', width: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="sc-h" style={{ margin: 0 }}>Keyboard shortcuts</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="muted small">Shortcuts work anywhere except while you are typing in a field.</p>
      <div className="shortcuts">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label}><span>{label}</span><span className="row" style={{ gap: 4 }}>{keys.map((k) => <span key={k} className="kbd">{k}</span>)}</span></div>
        ))}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ user menu */
function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { toggleTheme, resolved } = useSettings();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const go = (to) => { setOpen(false); navigate(to); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="user-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} />
        <span className="meta"><b>{user.name}</b><span>{humanize(user.role)}</span></span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="menu" role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            <div className="menu-head"><Avatar name={user.name} size={38} /><div><b>{user.name}</b><span>{user.email}</span></div></div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => go('/profile')}><User /> Profile</button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => go('/settings')}><Settings /> Settings <span className="kbd">G S</span></button>
            <button type="button" role="menuitem" className="menu-item" onClick={(e) => { toggleTheme(e); }}>{resolved === 'dark' ? <Sun /> : <Moon />} {resolved === 'dark' ? 'Light mode' : 'Dark mode'} <span className="kbd">T</span></button>
            <div className="menu-sep" />
            <button type="button" role="menuitem" className="menu-item" onClick={async () => { setOpen(false); await logout(); navigate('/login', { replace: true }); }}><LogOut /> Log out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button type="button" className="icon-btn" title="Log out" aria-label="Log out"
      onClick={async () => { await logout(); navigate('/login', { replace: true }); }}><LogOut /></button>
  );
}

/* ------------------------------------------------------------------ shell */
const TITLES = {
  claims: 'My claims', approvals: 'Approvals', audit: 'Audit queue', dashboard: 'Dashboard', payouts: 'Payouts', policy: 'Policy',
  delegations: 'Delegation', employees: 'Employee details', profile: 'Profile', settings: 'Settings', activity: 'Audit trail',
};

export default function Shell({ children }) {
  const { user } = useAuth();
  const { settings, set, toggleTheme, resolved } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);
  const first = useRef(true);
  const live = useLiveData(user);
  const health = useHealth();
  const [palette, setPalette] = useState(false);
  const [notif, setNotif] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [seen, setSeen] = useState(0);
  const nav = navFor(user);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Global keyboard shortcuts
  useEffect(() => {
    let g = false; let gt;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      const t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || document.querySelector('dialog[open]')) return;
      if (palette) return;
      const k = e.key.toLowerCase();
      if (g) {
        g = false; clearTimeout(gt);
        const target = nav.find((n) => n.key === k);
        if (target) { e.preventDefault(); navigate(target.to); }
        return;
      }
      if (k === 'g') { g = true; gt = setTimeout(() => { g = false; }, 900); return; }
      if (e.key === '?') { e.preventDefault(); setShortcuts(true); return; }
      if (k === 'n' && !location.pathname.startsWith('/approvals/')) { e.preventDefault(); navigate('/claims/new'); return; }
      if (k === 't') { toggleTheme(); return; }
      if (e.key === '[') { set((s) => ({ collapsed: !s.collapsed })); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gt); };
  }, [nav, navigate, palette, toggleTheme, set, location.pathname]);

  const seg = location.pathname.split('/')[1];
  const title = TITLES[seg] || 'ExpenseFlow';
  const sub = location.pathname.split('/')[2];
  const badgeCount = (b) => (b ? live.counts[b] : 0);
  const notifCount = (settings.notifyApprovals ? live.counts.inbox : 0) + (settings.notifySentBack ? live.counts.mine : 0);
  const tabs = nav.filter((n) => n.to && ['/dashboard', '/claims', '/approvals', '/audit', '/settings'].includes(n.to)).slice(0, 4);
  if (!tabs.find((t) => t.to === '/settings')) tabs.push(nav.find((n) => n.to === '/settings'));

  return (
    <div className="layout" data-collapsed={settings.collapsed}>
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar" aria-label="Sidebar">
        <NavLink to="/" className="sb-brand" aria-label="ExpenseFlow home">
          <AppIcon size={38} />
          <span className="sb-hide"><Wordmark /></span>
        </NavLink>
        <nav aria-label="Main">
          <LayoutGroup id="sb">
            <ul className="sb-nav">
              {nav.map((n) => (n.section ? (
                <li key={n.section} className="sb-section sb-hide" aria-hidden="true">{n.section}</li>
              ) : (
                <li key={n.to}>
                  <NavLink to={n.to} className="sb-link" title={settings.collapsed ? n.label : undefined}>
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="sb-active" className="sb-active" transition={{ type: 'spring', stiffness: 450, damping: 36 }} />}
                        <n.icon aria-hidden="true" />
                        <span className="sb-hide">{n.label}</span>
                        {badgeCount(n.badge) > 0 && <span className="sb-badge" aria-label={`${badgeCount(n.badge)} waiting`}>{badgeCount(n.badge)}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              )))}
            </ul>
          </LayoutGroup>
        </nav>
        <div className="sb-spacer" />
        <NavLink to="/claims/new" className="btn btn-accent sb-hide" style={{ width: '100%', minHeight: 44 }}><FilePlus2 aria-hidden="true" /> New claim</NavLink>
        <div className="sb-card sb-hide">
          <div className="sb-health"><span className={`dot ${health.api !== 'ok' || !health.online ? 'down' : ''}`} />
            <strong style={{ margin: 0 }}>{!health.online ? 'You are offline' : health.api === 'ok' ? 'All systems normal' : 'Service degraded'}</strong></div>
          <div style={{ marginTop: 4 }}>Policy engine · IST {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date())}</div>
        </div>
        <button type="button" className="sb-collapse" onClick={() => set({ collapsed: !settings.collapsed })} aria-label={settings.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {settings.collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}<span className="sb-hide">Collapse</span>
        </button>
      </aside>

      <div className="content">
        <header className="topbar">
          <NavLink to="/" className="brand-mini" aria-label="ExpenseFlow home"><AppIcon size={30} /></NavLink>
          <div className="crumbs">
            <span className="crumb-root">ExpenseFlow</span><span className="crumb-root">/</span>
            <strong>{title}</strong>
            {sub && <><span>/</span><span>{sub === 'new' ? 'New' : sub === 'edit' ? 'Edit' : `#${sub}`}</span></>}
          </div>
          <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Search and commands (Ctrl K)">
            <Search aria-hidden="true" /><span className="label">Search or jump to…</span><span className="kbd">Ctrl K</span>
          </button>
          <button type="button" className="icon-btn" onClick={(e) => toggleTheme(e)} aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title="Toggle theme (T)">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={resolved} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }} style={{ display: 'grid' }}>
                {resolved === 'dark' ? <Sun /> : <Moon />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button type="button" className="icon-btn" onClick={() => { setNotif(true); setSeen(notifCount); }} aria-label={`Notifications, ${notifCount} new`} title="Notifications">
            <Bell />{notifCount > seen && <span className="ping" />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setShortcuts(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><CircleHelp /></button>
          <UserMenu user={user} />
          <LogoutButton />
        </header>
        {(!health.online || health.api === 'down') && (
          <div className="offline-banner" role="alert"><WifiOff size={16} /> {health.online ? 'We can’t reach the ExpenseFlow server. Your changes will not be saved until it’s back.' : 'You’re offline. Reconnect to keep working.'}</div>
        )}
        <main id="main" tabIndex={-1} ref={mainRef}>
          <p className="visually-hidden">Signed in as {user.name}, {humanize(user.role)}</p>
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Quick navigation">
        {tabs.filter(Boolean).map((n) => (
          <NavLink key={n.to} to={n.to}>
            <n.icon aria-hidden="true" />{n.label.replace('My claims', 'Claims').replace('Audit queue', 'Audit')}
            {badgeCount(n.badge) > 0 && <span className="sb-badge">{badgeCount(n.badge)}</span>}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} user={user} live={live} onShortcuts={() => setShortcuts(true)} />
      <NotificationSheet open={notif} onClose={() => setNotif(false)} live={live} user={user} />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}
