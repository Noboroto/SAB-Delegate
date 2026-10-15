import type { CSSProperties, ReactNode } from 'react';

interface ActionRowProps {
  children: ReactNode;
  /** `end` right-aligns a dialog-style footer; rows of controls start on the left edge. */
  align?: 'start' | 'end';
  style?: CSSProperties;
}

/**
 * A row of buttons, inputs or short text that shares one left edge, one gap
 * (`--space-2`) and one centre line. Plain flex rather than AntD `Space`:
 * `Space` wraps every child in its own item, so a `display: none` file input or
 * an empty fragment still gets a gap and pushes the row off the edge of the
 * buttons stacked below it. Controls inside must use the default size so they
 * all measure `--control-h`.
 */
export function ActionRow({ children, align = 'start', style }: ActionRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
        gap: 'var(--space-2)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
