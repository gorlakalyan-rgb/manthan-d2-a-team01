import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get('/api/auth/me');
      setUser(data?.user || null);
    } catch {
      setUser(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setUser(null));
  }, [refresh]);

  const login = useCallback(async (email, password, role) => {
    const data = await post('/api/auth/login', { email, password, ...(role ? { role } : {}) });
    if (data?.user) setUser(data.user);
    else await refresh();
    return data?.user;
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await post('/api/auth/logout'); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, checking, login, logout, refresh }), [user, checking, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function roleCaps(user) {
  const role = user?.role;
  const isApprover = role === 'manager' || role === 'auditor' || role === 'head' || !!user?.is_manager;
  return {
    isApprover,
    canDelegate: isApprover,
    isAuditor: role === 'auditor' || role === 'head',
    isHead: role === 'head',
  };
}
