import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'ef.settings';
const DEFAULTS = {
  mode: 'system',          // light | dark | system
  accent: 'forest',        // forest | ocean | plum | ember | graphite
  density: 'comfortable',  // comfortable | compact
  motion: 'system',        // system | reduced
  collapsed: false,        // sidebar
  sounds: false,
  notifyApprovals: true,
  notifySentBack: true,
  notifyPayouts: true,
  digest: 'daily',
  startPage: 'auto',
};

export const ACCENTS = [
  { id: 'forest', name: 'Forest ledger', brand: '#0f2e2a', brand2: '#1d5a4f', accent: '#e89b2d' },
  { id: 'ocean', name: 'Harbour', brand: '#0c2a43', brand2: '#1b5b8a', accent: '#f2a541' },
  { id: 'plum', name: 'Aubergine', brand: '#2b1433', brand2: '#5d2f6e', accent: '#e9b949' },
  { id: 'ember', name: 'Terracotta', brand: '#3a160d', brand2: '#8a3a1d', accent: '#f0c04b' },
  { id: 'graphite', name: 'Graphite', brand: '#16181d', brand2: '#3b414d', accent: '#e89b2d' },
];

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

const Ctx = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const fn = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const resolved = settings.mode === 'system' ? (systemDark ? 'dark' : 'light') : settings.mode;

  useEffect(() => {
    const d = document.documentElement;
    d.dataset.theme = resolved;
    d.dataset.accent = settings.accent;
    d.dataset.density = settings.density;
    if (settings.motion === 'reduced') d.dataset.motion = 'reduced'; else delete d.dataset.motion;
    const meta = document.querySelector('meta[name="theme-color"]');
    const a = ACCENTS.find((x) => x.id === settings.accent) || ACCENTS[0];
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b1210' : a.brand);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }, [settings, resolved]);

  const set = useCallback((patch) => setSettings((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })), []);
  const reset = useCallback(() => setSettings({ ...DEFAULTS }), []);

  /** Toggle light/dark with a circular reveal (View Transitions) when available. */
  const toggleTheme = useCallback((evt) => {
    const next = resolved === 'dark' ? 'light' : 'dark';
    const apply = () => set({ mode: next });
    const reduce = settings.motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { apply(); return; }
    const x = evt?.clientX ?? window.innerWidth - 40;
    const y = evt?.clientY ?? 32;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = document.startViewTransition(() => {
      document.documentElement.dataset.theme = next;
      apply();
    });
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  }, [resolved, set, settings.motion]);

  const value = useMemo(() => ({ settings, set, reset, resolved, toggleTheme }), [settings, set, reset, resolved, toggleTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() { return useContext(Ctx); }
