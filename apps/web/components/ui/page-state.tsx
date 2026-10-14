'use client';

import { Button, Result } from 'antd';
import Link from 'next/link';

interface PageStateAction {
  label: string;
  /** A link when `href` is set, otherwise a button that runs `onClick`. */
  href?: string;
  onClick?: () => void;
}

interface PageStateProps {
  status: 'error' | '404' | 'info';
  title: string;
  body: string;
  action?: PageStateAction;
}

/** One full-width message for "not found", "failed to load" and "nothing here yet". */
export function PageState({ status, title, body, action }: PageStateProps) {
  return (
    <Result
      status={status}
      title={title}
      subTitle={body}
      extra={
        action === undefined ? undefined : action.href !== undefined ? (
          <Link href={action.href}>
            <Button type="primary">{action.label}</Button>
          </Link>
        ) : (
          <Button type="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      }
    />
  );
}
