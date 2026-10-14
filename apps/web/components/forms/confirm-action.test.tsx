import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ConfirmAction, PREVIEW_TTL_MS } from './confirm-action';

interface Plan {
  count: number;
}

function setup(
  options: {
    preview?: () => Promise<Plan>;
    execute?: () => Promise<{ deleted: number }>;
    canConfirm?: (plan: Plan) => boolean;
  } = {},
) {
  const preview = vi.fn(options.preview ?? (() => Promise.resolve({ count: 3 })));
  const execute = vi.fn(options.execute ?? (() => Promise.resolve({ deleted: 3 })));
  const onDone = vi.fn();
  renderWithProviders(
    <ConfirmAction
      label="Delete"
      modalTitle="Delete messages"
      confirmLabel="Delete 3"
      preview={preview}
      execute={execute}
      renderPlan={(plan: Plan) => <p>{plan.count} will be deleted</p>}
      canConfirm={options.canConfirm}
      onDone={onDone}
    />,
  );
  return { preview, execute, onDone };
}

const trigger = () => screen.getByRole('button', { name: 'Delete' });
const confirmButton = () => screen.findByRole('button', { name: 'Delete 3' });

afterEach(() => {
  vi.useRealTimers();
});

describe('ConfirmAction', () => {
  it('asks the service for the plan before anything runs, and cancel runs nothing', async () => {
    const { preview, execute, onDone } = setup();
    await userEvent.click(trigger());
    expect(await screen.findByText('3 will be deleted')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(execute).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps confirm off until the plan is on screen', async () => {
    const { execute } = setup({ preview: () => new Promise<Plan>(() => undefined) });
    await userEvent.click(trigger());
    const button = await confirmButton();
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs the real call once after the person confirms the plan', async () => {
    const { preview, execute, onDone } = setup();
    await userEvent.click(trigger());
    await screen.findByText('3 will be deleted');
    await userEvent.dblClick(await confirmButton());

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ deleted: 3 }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('keeps confirm off when the plan says there is nothing to do', async () => {
    setup({ preview: () => Promise.resolve({ count: 0 }), canConfirm: (plan) => plan.count > 0 });
    await userEvent.click(trigger());
    await screen.findByText('0 will be deleted');
    expect(await confirmButton()).toBeDisabled();
  });

  it('shows a failed preview as a translated error and can ask again', async () => {
    const preview = vi
      .fn<() => Promise<Plan>>()
      .mockRejectedValueOnce(new ApiRequestError(502, 'DISCORD_API_ERROR'))
      .mockResolvedValueOnce({ count: 3 });
    const { execute } = setup({ preview });
    await userEvent.click(trigger());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Discord trả về lỗi. Vui lòng thử lại sau.',
    );
    expect(await confirmButton()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('3 will be deleted')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('asks for a fresh plan instead of running an old one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { preview, execute } = setup();
    await userEvent.click(trigger());
    await screen.findByText('3 will be deleted');

    vi.setSystemTime(Date.now() + PREVIEW_TTL_MS + 1000);
    await userEvent.click(await confirmButton());

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(execute).not.toHaveBeenCalled();
  });

  it('needs a new plan after a confirm that failed', async () => {
    const execute = vi.fn(() => Promise.reject(new ApiRequestError(500, 'INTERNAL')));
    const { preview } = setup({ execute });
    await userEvent.click(trigger());
    await screen.findByText('3 will be deleted');
    await userEvent.click(await confirmButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Đã có lỗi xảy ra. Vui lòng thử lại sau.',
    );
    // happy-dom never ends AntD's leave animation, so the spinner stays in the name.
    await userEvent.click(await screen.findByRole('button', { name: /Xem lại kế hoạch$/ }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('shows the short label and names the full scope for assistive technology', () => {
    renderWithProviders(
      <ConfirmAction
        label="Delete"
        ariaLabel="Delete a very long name somebody typed"
        modalTitle="Delete"
        confirmLabel="Delete"
        preview={() => Promise.resolve({ count: 1 })}
        execute={() => Promise.resolve({ deleted: 1 })}
        renderPlan={() => null}
      />,
    );
    const button = screen.getByRole('button', { name: 'Delete a very long name somebody typed' });
    expect(button).toHaveTextContent(/^Delete$/);
  });
});
