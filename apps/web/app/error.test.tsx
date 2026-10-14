import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import AppRouteError from './(app)/error';
import RouteError from './error';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe('route error boundary', () => {
  it('shows the translated message and never the error text', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <RouteError error={new Error('relation "GuildConfig" does not exist')} reset={vi.fn()} />,
    );
    expect(screen.getByText('Không tải được trang')).toBeInTheDocument();
    expect(screen.queryByText(/GuildConfig/)).not.toBeInTheDocument();
  });

  it('retries through the reset callback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reset = vi.fn();
    renderWithProviders(<RouteError error={new Error('x')} reset={reset} />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('brings its own main landmark outside the signed-in frame, and none inside it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outside = renderWithProviders(<RouteError error={new Error('x')} reset={vi.fn()} />);
    expect(outside.container.querySelectorAll('main')).toHaveLength(1);
    outside.unmount();

    const inside = renderWithProviders(<AppRouteError error={new Error('x')} reset={vi.fn()} />);
    expect(inside.container.querySelectorAll('main')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
