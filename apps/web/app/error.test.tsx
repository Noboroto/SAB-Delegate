import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
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
});
