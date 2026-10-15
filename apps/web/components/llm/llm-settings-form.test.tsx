import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmSettings } from '@sab/shared';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LlmSettingsForm } from './llm-settings-form';

const GUILD = '1'.repeat(18);

const SETTINGS: LlmSettings = {
  adminServer: true,
  available: true,
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-test',
  keyLast4: 'abcd',
};

/** Records every request and answers each with `answer`. */
function stubFetch(answer: unknown) {
  const calls: { url: string; method: string | undefined; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
      calls.push({ url, method: init?.method, body });
      return Promise.resolve(new Response(JSON.stringify(answer)));
    }),
  );
  return calls;
}

beforeEach(() => {
  refresh.mockReset();
});

describe('LlmSettingsForm', () => {
  it('shows the stored values and the last four characters of the key', () => {
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);
    expect(screen.getByLabelText('Địa chỉ API')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('Mô hình')).toHaveValue('gpt-test');
    expect(screen.getByLabelText('Khoá API')).toHaveAttribute('placeholder', '•••• abcd');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('tells that LLM settings cannot be saved when the server has no secret', () => {
    renderWithProviders(
      <LlmSettingsForm guildId={GUILD} settings={{ ...SETTINGS, available: false }} />,
    );
    expect(screen.getByText(/LLM_KEY_SECRET/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(screen.getByLabelText('Mô hình')).toBeDisabled();
  });

  it('saves without an apiKey when the key field is untouched', async () => {
    const calls = stubFetch(SETTINGS);
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Đã lưu cài đặt LLM.')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `/api/guilds/${GUILD}/llm`,
      method: 'PUT',
      body: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', enabled: true },
    });
    expect(calls[0]?.body).not.toHaveProperty('apiKey');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('asks for a key when the address changes and sends none until it is given', async () => {
    const calls = stubFetch(SETTINGS);
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    const address = screen.getByLabelText('Địa chỉ API');
    await userEvent.clear(address);
    await userEvent.type(address, 'https://openrouter.ai/api/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText(/Nhập khoá API/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the translated reason when the connection test fails', async () => {
    const calls = stubFetch({ ok: false, reason: 'unauthorized' });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));

    await waitFor(() => expect(screen.getByText(/Khoá API bị từ chối/)).toBeInTheDocument());
    expect(calls[0]).toMatchObject({ url: `/api/guilds/${GUILD}/llm/test`, method: 'POST' });
  });
});
