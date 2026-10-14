'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorCodeSchema } from '@sab/shared';
import { ApiRequestError } from './api-response';

export type MutationResult<TData> =
  { ok: true; data: TData } | { ok: false; error: ApiRequestError };

/** A network failure or an unparsable answer has no status from the server; 0 says "no answer". */
function toRequestError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError ? error : new ApiRequestError(0);
}

/**
 * Runs one write at a time. A second `run` while the first is in flight does
 * nothing and returns `undefined`: the guard is a ref, because two clicks in
 * the same frame both read `pending === false` from state. `run` never
 * rejects; the outcome carries the `ApiRequestError` (and so its `code`).
 */
export function useApiMutation<TVars, TData>(mutate: (vars: TVars) => Promise<TData>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiRequestError | undefined>(undefined);
  const inFlight = useRef(false);
  const latest = useRef(mutate);
  latest.current = mutate;

  const run = useCallback(async (vars: TVars): Promise<MutationResult<TData> | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      return { ok: true, data: await latest.current(vars) };
    } catch (caught) {
      const failure = toRequestError(caught);
      setError(failure);
      return { ok: false, error: failure };
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(undefined), []);

  return { run, pending, error, code: error?.code, reset };
}

/**
 * Turns a failure into the sentence a person reads: the translation of the
 * server's `ErrorCode`, or the generic one for no code, an unknown code or a
 * failure that never reached the server. The error's own text is English for
 * logs and is never shown.
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const tErrors = useTranslations('errors');
  const tWeb = useTranslations('web');

  return useCallback(
    (error: unknown) => {
      const code = error instanceof ApiRequestError ? error.code : undefined;
      const known = ErrorCodeSchema.safeParse(code);
      // `permission` feeds the one message that varies by detail; the server's
      // detail is not kept, so the neutral wording applies.
      return known.success ? tErrors(known.data, { permission: 'other' }) : tWeb('genericError');
    },
    [tErrors, tWeb],
  );
}
