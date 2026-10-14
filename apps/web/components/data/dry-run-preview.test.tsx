import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { DryRunPreview } from './dry-run-preview';

describe('DryRunPreview', () => {
  it('announces that the plan is being prepared', () => {
    renderWithProviders(
      <DryRunPreview state={{ status: 'loading' }} renderPlan={() => null} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('status', { name: 'Đang chuẩn bị kế hoạch...' })).toBeInTheDocument();
  });

  it('shows the plan exactly as the caller draws it, under a title', () => {
    renderWithProviders(
      <DryRunPreview
        state={{ status: 'ready', plan: { toDelete: 7 } }}
        renderPlan={(plan) => <p>{plan.toDelete} messages</p>}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Kế hoạch sẽ thực hiện')).toBeInTheDocument();
    expect(screen.getByText('7 messages')).toBeInTheDocument();
  });

  it('shows a translated error and asks again on retry', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <DryRunPreview
        state={{ status: 'error', error: new ApiRequestError(502, 'DISCORD_API_ERROR') }}
        renderPlan={() => <p>never</p>}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Discord trả về lỗi. Vui lòng thử lại sau.',
    );
    expect(screen.queryByText('never')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
