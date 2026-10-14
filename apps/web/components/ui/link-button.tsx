import Link from 'next/link';
import type { ReactNode } from 'react';

interface LinkButtonProps {
  href: string;
  children: ReactNode;
  /** `primary` is the one main action of a screen; `default` is a plain outlined button. */
  variant?: 'primary' | 'default';
}

/**
 * A navigation that looks like a button. One element, one tab stop: a link
 * wrapped around a `<button>` is invalid HTML and announces twice. Styles live
 * in globals.css (`.link-button`) and read the same tokens as the AntD theme.
 */
export function LinkButton({ href, children, variant = 'default' }: LinkButtonProps) {
  return (
    <Link href={href} className={`link-button link-button-${variant}`}>
      {children}
    </Link>
  );
}
