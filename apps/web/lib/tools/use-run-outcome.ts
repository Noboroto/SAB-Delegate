'use client';

import { useCallback, useState } from 'react';

/**
 * Keeps what a confirmed run returned, but only shows it while the form still
 * describes that run: `signature` is the request the form builds now, so an
 * edit makes the old answer disappear instead of passing for the new form's.
 */
export function useRunOutcome<T>(signature: string | undefined) {
  const [state, setState] = useState<{ value: T; signature: string | undefined } | undefined>(
    undefined,
  );
  const outcome = state !== undefined && state.signature === signature ? state.value : undefined;
  const record = useCallback((value: T) => setState({ value, signature }), [signature]);
  return [outcome, record] as const;
}
