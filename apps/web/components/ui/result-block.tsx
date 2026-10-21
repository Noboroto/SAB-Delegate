import type { ReactNode } from 'react';

/** Wraps the result or error shown under a form, so it sits `--space-4` below the buttons. */
export function ResultBlock({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 'var(--space-4)' }}>{children}</div>;
}
