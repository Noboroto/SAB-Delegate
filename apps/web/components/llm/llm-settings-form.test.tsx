import { act, screen, waitFor } from '@testing-library/react';
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

describe('LlmSettingsForm: fetching the model list', () => {
  const FETCH = 'Lấy danh sách mô hình';
  const modelsUrl = `/api/guilds/${GUILD}/llm/models`;

  it('offers the fetched ids in the model input and counts them', async () => {
    const calls = stubFetch({ ok: true, models: ['gpt-alpha', 'gpt-beta', 'other-one'] });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByRole('button', { name: FETCH }));

    expect(await screen.findByText('3 mô hình')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: modelsUrl,
      method: 'POST',
      body: { baseUrl: 'https://api.openai.com/v1' },
    });
    expect(calls[0]?.body).not.toHaveProperty('apiKey');

    const model = screen.getByLabelText('Mô hình');
    await userEvent.clear(model);
    await userEvent.type(model, 'gpt');
    // The list is also mirrored for assistive tech, so an id can appear twice.
    expect((await screen.findAllByText('gpt-beta')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('other-one')).toHaveLength(0);
  });

  it('lets a model that is not in the list be typed', async () => {
    const calls = stubFetch({ ok: true, models: ['gpt-alpha'] });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);
    await userEvent.click(screen.getByRole('button', { name: FETCH }));
    await screen.findByText('1 mô hình');

    const model = screen.getByLabelText('Mô hình');
    await userEvent.clear(model);
    await userEvent.type(model, 'my-own-model');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { model: 'my-own-model' } });
  });

  it('sends the key typed, and only to the models route', async () => {
    const calls = stubFetch({ ok: true, models: [] });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);
    const typed = 'k'.repeat(24);
    await userEvent.type(screen.getByLabelText('Khoá API'), typed);

    await userEvent.click(screen.getByRole('button', { name: FETCH }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: modelsUrl, body: { apiKey: typed } });
  });

  it('shows the translated reason when the endpoint refuses', async () => {
    stubFetch({ ok: false, reason: 'unauthorized' });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByRole('button', { name: FETCH }));

    expect(await screen.findByText(/Khoá API bị từ chối/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ mô hình$/)).not.toBeInTheDocument();
  });

  it('shows the server error when no key can be used for the address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'LLM_KEY_REQUIRED', message: 'x' }), { status: 400 }),
        ),
      ),
    );
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByRole('button', { name: FETCH }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('is disabled until the address is a valid https one', async () => {
    const calls = stubFetch({ ok: true, models: [] });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);
    const button = screen.getByRole('button', { name: FETCH });
    const address = screen.getByLabelText('Địa chỉ API');

    await userEvent.clear(address);
    expect(button).toBeDisabled();
    await userEvent.type(address, 'http://plain.example.com/v1');
    expect(button).toBeDisabled();
    await userEvent.clear(address);
    await userEvent.type(address, 'https://api.example.com/v1');
    expect(button).toBeEnabled();
    expect(calls).toHaveLength(0);
  });

  it('sends one request however fast the button is clicked', async () => {
    let release: (response: Response) => void = () => undefined;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.dblClick(screen.getByRole('button', { name: FETCH }));
    expect(calls).toEqual([modelsUrl]);

    await act(async () => {
      release(new Response(JSON.stringify({ ok: true, models: ['a'] })));
      await Promise.resolve();
    });
    expect(await screen.findByText('1 mô hình')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('forgets the list when the address changes', async () => {
    stubFetch({ ok: true, models: ['gpt-alpha'] });
    renderWithProviders(<LlmSettingsForm guildId={GUILD} settings={SETTINGS} />);
    await userEvent.click(screen.getByRole('button', { name: FETCH }));
    await screen.findByText('1 mô hình');

    await userEvent.type(screen.getByLabelText('Địa chỉ API'), '2');

    await waitFor(() => expect(screen.queryByText('1 mô hình')).not.toBeInTheDocument());
  });
});
