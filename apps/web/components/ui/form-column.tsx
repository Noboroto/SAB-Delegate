import type { ReactNode } from 'react';

/**
 * The single column every settings form sits in: at most `--form-w` wide, full
 * width on a phone, children stacked `--space-4` apart.
 */
export function FormColumn({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        width: '100%',
        maxWidth: 'var(--form-w)',
      }}
    >
      {children}
    </div>
  );
}
