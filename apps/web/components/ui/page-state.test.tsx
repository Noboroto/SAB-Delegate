import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { PageState } from './page-state';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('PageState', () => {
  it('is the page heading by default and a second-level heading under a page title', () => {
    const { rerender } = renderWithProviders(<PageState status="info" title="Nothing" body="b" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing' })).toBeInTheDocument();
    rerender(<PageState status="info" title="Nothing" body="b" headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows a loading button that ignores clicks while it runs', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <PageState
        status="info"
        title="t"
        body="b"
        action={{ label: 'Go', onClick, loading: true }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Go/ }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link action as one link, not a button inside a link', () => {
    const { container } = renderWithProviders(
      <PageState status="info" title="t" body="b" action={{ label: 'Open', href: '/servers' }} />,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', '/servers');
    expect(container.querySelector('a button, button a')).toBeNull();
  });
});
