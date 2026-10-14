'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/api-fetch';
import { ApiRequestError, type ResponseParser } from '@/lib/api/api-response';

export interface LookupState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiRequestError | undefined;
  /** Asks again; the previous list stays on screen until the new one arrives. */
  reload: () => void;
}

/**
 * Reads one lookup route of the server. `path === null` is "nothing to ask
 * yet" (no search text) and neither loads nor errors. A newer path or an
 * unmount aborts the request in flight, so a slow old answer cannot replace a
 * newer one. `parser` must be a stable reference (a module-level schema).
 */
export function useLookup<T>(path: string | null, parser: ResponseParser<T>): LookupState<T> {
  const [state, setState] = useState<Omit<LookupState<T>, 'reload'>>({
    data: undefined,
    loading: path !== null,
    error: undefined,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (path === null) {
      setState({ data: undefined, loading: false, error: undefined });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ data: previous.data, loading: true, error: undefined }));
    apiFetch(path, { parser, signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: undefined });
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        const error = caught instanceof ApiRequestError ? caught : new ApiRequestError(0);
        setState((previous) => ({ data: previous.data, loading: false, error }));
      },
    );
    return () => controller.abort();
  }, [path, parser, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, reload };
}
