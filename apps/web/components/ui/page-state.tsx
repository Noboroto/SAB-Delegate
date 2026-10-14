'use client';

import { Button, Result } from 'antd';
import { LinkButton } from './link-button';

interface PageStateAction {
  label: string;
  /** A link when `href` is set, otherwise a button that runs `onClick`. */
  href?: string;
  onClick?: () => void;
  /** Shows the spinner and blocks further clicks on a button action. */
  loading?: boolean;
}

interface PageStateProps {
  status: 'error' | '404' | 'info';
  title: string;
  body: string;
  action?: PageStateAction;
  /** `h1` when the message is the whole page, `h2` when it sits under a page title. */
  headingLevel?: 1 | 2;
}

/** One full-width message for "not found", "failed to load" and "nothing here yet". */
export function PageState({ status, title, body, action, headingLevel = 1 }: PageStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <Result
      status={status}
      // The title keeps the look of the result's own title: the element is there
      // for the page outline, not for a different size.
      title={<Heading style={{ margin: 0, font: 'inherit' }}>{title}</Heading>}
      subTitle={body}
      extra={
        action === undefined ? undefined : action.href !== undefined ? (
          <LinkButton href={action.href} variant="primary">
            {action.label}
          </LinkButton>
        ) : (
          <Button type="primary" loading={action.loading} onClick={action.onClick}>
            {action.label}
          </Button>
        )
      }
    />
  );
}
