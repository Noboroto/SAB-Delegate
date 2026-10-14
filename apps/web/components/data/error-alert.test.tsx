import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ErrorAlert } from './error-alert';

describe('ErrorAlert', () => {
  it('shows the translation of the error code in the page language', () => {
    const error = new ApiRequestError(429, 'RATE_LIMITED');
    const { unmount } = renderWithProviders(<ErrorAlert error={error} />, 'vi');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.',
    );
    unmount();
    renderWithProviders(<ErrorAlert error={error} />, 'en');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many requests. Please wait a moment and try again.',
    );
  });

  it('never prints the error text', () => {
    renderWithProviders(<ErrorAlert error={new Error('secret internal detail')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Đã có lỗi xảy ra. Vui lòng thử lại.');
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
  });

  it('offers a retry only when asked to', async () => {
    const onRetry = vi.fn();
    const first = renderWithProviders(<ErrorAlert error={new ApiRequestError(500)} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    first.unmount();
    renderWithProviders(<ErrorAlert error={new ApiRequestError(500)} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
