import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { useToolRun } from './use-tool-run';

function Probe({
  call,
  vars,
}: {
  call: (vars: string) => Promise<string>;
  vars: string | undefined;
}) {
  const action = useToolRun(call);
  return (
    <div>
      <button onClick={() => void action.submit(vars, { refresh: true, success: 'Saved.' })}>
        go
      </button>
      <span>{action.pending ? 'pending' : 'idle'}</span>
      <span>{action.result ?? 'no result'}</span>
    </div>
  );
}

beforeEach(() => {
  refresh.mockReset();
});

describe('useToolRun', () => {
  it('sends one request for a double click, keeps the answer and refreshes the page', async () => {
    // Slow enough that the second click lands while the first call is in flight.
    const call = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('answer'), 40)),
    );
    renderWithProviders(<Probe call={call} vars="x" />);
    await userEvent.dblClick(screen.getByRole('button', { name: 'go' }));

    expect(await screen.findByText('answer')).toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('sends nothing for a form the schema rejected, and says so', async () => {
    const call = vi.fn(() => Promise.resolve('answer'));
    renderWithProviders(<Probe call={call} vars={undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(
      await screen.findByText('Hãy kiểm tra lại biểu mẫu: có trường còn thiếu hoặc chưa hợp lệ.'),
    ).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh the page when the call fails', async () => {
    const call = vi.fn(() => Promise.reject(new Error('boom')));
    renderWithProviders(<Probe call={call} vars="x" />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));

    await waitFor(() => expect(screen.getByText('idle')).toBeInTheDocument());
    expect(screen.getByText('no result')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
