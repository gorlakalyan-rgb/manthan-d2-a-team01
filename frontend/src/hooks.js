import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader and expose {data, error, loading, reload, setData}.
 * `deps` re-trigger the load. Stale responses are ignored.
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; });

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    loaderRef.current = loader;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((data) => setState((s) => ({ ...s, data })), []);
  return { ...state, reload, setData };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ExpenseFlow` : 'ExpenseFlow';
  }, [title]);
}
