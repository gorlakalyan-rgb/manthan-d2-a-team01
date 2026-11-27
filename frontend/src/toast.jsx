import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

const Ctx = createContext(null);
const ICON = { success: CheckCircle2, error: XCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((title, { kind = 'success', body, action, duration = 4500 } = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, title, kind, body, action }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICON[t.kind] || Info;
            return (
              <motion.div key={t.id} layout className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.16 } }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
                <Icon aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <b>{t.title}</b>
                  {t.body && <span>{t.body}</span>}
                  {t.action && (
                    <div style={{ marginTop: 6 }}>
                      <button type="button" style={{ color: 'var(--accent)', fontWeight: 700, margin: 0 }} onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><X size={16} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() { return useContext(Ctx); }
