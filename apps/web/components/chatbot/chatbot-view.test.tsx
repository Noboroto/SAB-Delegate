import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatbotConfig } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import {
  GENERAL,
  GUILD,
  RANDOM,
  bodyOf,
  deferred,
  stubApi,
  writesOf,
} from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/chatbot',
}));

import { ChatbotView } from './chatbot-view';

const CHATBOT = `/api/guilds/${GUILD}/chatbot`;

const CONFIG: ChatbotConfig = {
  enabled: true,
  defaultMonthlyLimit: 100_000,
  channels: [GENERAL],
  llm: {
    source: 'global',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-test',
    keyLast4: 'abcd',
    globalAvailable: true,
  },
};

const OWN_LLM: ChatbotConfig['llm'] = { ...CONFIG.llm, source: 'guild' };

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    enabled: 'Bật chatbot',
    turnedOff: 'Đã tắt chatbot.',
    defaultLimit: 'Hạn mức mỗi thành viên mỗi tháng (token)',
    saveLimit: 'Lưu hạn mức',
    limitSaved: 'Đã lưu hạn mức hàng tháng.',
    pick: 'Chọn kênh để thêm',
    add: 'Thêm kênh',
    removeGeneral: 'Gỡ kênh general',
    added: 'Đã thêm kênh.',
    inUse: 'Kênh này đang dùng cho một trò chơi hoặc chatbot. Chọn kênh khác nhé.',
    sourceGlobal: 'Dịch vụ dùng chung cho mọi máy chủ',
    openGlobal: 'Mở cài đặt dịch vụ dùng chung',
    baseUrl: 'Địa chỉ API',
    model: 'Mô hình',
    apiKey: 'Khoá API',
    llmSave: 'Lưu',
    fetchModels: 'Lấy danh sách mô hình',
    twoModels: '2 mô hình',
    llmSaved: 'Đã lưu dịch vụ AI.',
    keyRequired: 'Nhập khoá API (lần đầu lưu hoặc khi đổi địa chỉ API).',
    useShared: 'Dùng dịch vụ chung',
    useSharedConfirm: 'Bỏ dịch vụ của máy chủ này',
    useSharedPlan:
      'Địa chỉ và khoá riêng của máy chủ này sẽ bị xoá. Chatbot sẽ dùng dịch vụ chung của mọi máy chủ.',
    clearAll: 'Xoá toàn bộ bộ nhớ',
    memoryConfirm: 'Xoá bộ nhớ',
    memoryPlan: 'Bot sẽ quên 3 bản tóm tắt về thành viên và 2 bản tóm tắt về kênh.',
    usageTab: 'Mức dùng',
    paused: /Chatbot tạm dừng đến .*15:00/,
  },
  en: {
    enabled: 'Chatbot on',
    turnedOff: 'The chatbot is off.',
    defaultLimit: 'Monthly limit per member (tokens)',
    saveLimit: 'Save limit',
    limitSaved: 'The monthly limit is saved.',
    pick: 'Select a channel to add',
    add: 'Add channel',
    removeGeneral: 'Remove channel general',
    added: 'The channel is added.',
    inUse: 'This channel is already used by a game or the chatbot. Pick another one.',
    sourceGlobal: 'The service shared by all servers',
    openGlobal: 'Open the shared service settings',
    baseUrl: 'API address',
    model: 'Model',
    apiKey: 'API key',
    llmSave: 'Save',
    fetchModels: 'Fetch models',
    twoModels: '2 models',
    llmSaved: 'The AI service is saved.',
    keyRequired: 'Enter an API key (on the first save or when the API address changes).',
    useShared: 'Use the shared service',
    useSharedConfirm: "Forget this server's service",
    useSharedPlan:
      "This server's own address and key are deleted. The chatbot then uses the service shared by all servers.",
    clearAll: 'Clear all memory',
    memoryConfirm: 'Clear memory',
    memoryPlan: 'The bot forgets 3 member summaries and 2 channel summaries.',
    usageTab: 'Usage',
    paused: /The chatbot is paused until .*15:00/,
  },
} as const;

function setup(
  locale: 'vi' | 'en',
  handler: (path: string, body: unknown) => unknown = () => CONFIG,
  config: ChatbotConfig = CONFIG,
  adminServer = false,
) {
  const fetchMock = stubApi((path, init) => handler(path, bodyOf(init)));
  renderWithProviders(
    <ChatbotView guildId={GUILD} config={config} tab="settings" adminServer={adminServer} />,
    locale,
  );
  return fetchMock;
}

/** Answers the channel list as the stub does, and every other call with a status and an error code. */
function failWith(status: number, code: string) {
  const fetchMock = vi.fn((input: string) =>
    Promise.resolve(
      input.endsWith('/discord/channels')
        ? new Response(
            JSON.stringify([
              { id: GENERAL, name: 'general', type: 0, parentId: null, position: 0 },
              { id: RANDOM, name: 'random', type: 0, parentId: null, position: 1 },
            ]),
          )
        : new Response(JSON.stringify({ code, message: 'secret internal detail' }), { status }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  nav.refresh.mockReset();
  nav.push.mockReset();
});

describe.each(SUPPORTED_LOCALES)('ChatbotView settings (%s)', (locale) => {
  const text = TEXT[locale];

  it('shows the switch, the limit, the channels and the model in plain language', async () => {
    setup(locale);
    expect(screen.getByRole('heading', { level: 1, name: 'Chatbot' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: text.enabled })).toBeChecked();
    expect(screen.getByLabelText<HTMLInputElement>(text.defaultLimit).value).toBe('100000');
    expect(await screen.findByText('# general')).toBeInTheDocument();
    expect(screen.getByText(text.sourceGlobal)).toBeInTheDocument();
    expect(screen.getByText('gpt-test')).toBeInTheDocument();
    expect(screen.getByText('api.openai.com')).toBeInTheDocument();
    // A missing translation shows as its key path.
    expect(document.body.textContent).not.toMatch(/web-chatbot|settings\.\w+\.|channels\.\w+\./);
  });

  it('links to the shared service settings in the admin server only', () => {
    setup(locale, undefined, CONFIG, true);
    expect(screen.getByRole('link', { name: text.openGlobal })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/settings/llm`,
    );
  });

  it('has no link to settings that do not exist in another server', () => {
    setup(locale);
    expect(screen.queryByRole('link', { name: text.openGlobal })).not.toBeInTheDocument();
  });

  it('says until when the chatbot is paused, in the business zone', () => {
    setup(locale, undefined, {
      ...CONFIG,
      llm: { ...CONFIG.llm, pausedUntil: '2026-10-16T08:00:00.000Z' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(text.paused);
  });

  it('switches the chatbot off and reads the server state back', async () => {
    const fetchMock = setup(locale, () => ({ ...CONFIG, enabled: false }));
    await userEvent.click(screen.getByRole('switch', { name: text.enabled }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(text.turnedOff)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      { path: `${CHATBOT}/config`, method: 'PATCH', body: { enabled: false } },
    ]);
  });

  it('sends one request however many times the switch is pressed while it is saving', async () => {
    const pending = deferred<ChatbotConfig>();
    const fetchMock = setup(locale, () => pending.promise);
    const toggle = screen.getByRole('switch', { name: text.enabled });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(writesOf(fetchMock)).toHaveLength(1);
    pending.resolve({ ...CONFIG, enabled: false });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
  });

  it('keeps the limit off until it changes, then saves it alone', async () => {
    const fetchMock = setup(locale, () => ({ ...CONFIG, defaultMonthlyLimit: 250_000 }));
    const save = screen.getByRole('button', { name: text.saveLimit });
    expect(save).toBeDisabled();

    const input = screen.getByLabelText(text.defaultLimit);
    await userEvent.clear(input);
    expect(save).toBeDisabled();
    await userEvent.type(input, '250000');
    await userEvent.click(save);

    expect(await screen.findByText(text.limitSaved)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      { path: `${CHATBOT}/config`, method: 'PATCH', body: { defaultMonthlyLimit: 250_000 } },
    ]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('adds the picked channel', async () => {
    const fetchMock = setup(locale);
    await userEvent.click(screen.getByRole('combobox', { name: text.pick }));
    await userEvent.click(await screen.findByText('# random'));
    await userEvent.click(screen.getByRole('button', { name: text.add }));

    expect(await screen.findByText(text.added)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      { path: `${CHATBOT}/channels/${RANDOM}`, method: 'PUT', body: undefined },
    ]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('says a channel a game uses is taken, in plain words', async () => {
    failWith(409, 'CHANNEL_IN_USE');
    renderWithProviders(
      <ChatbotView guildId={GUILD} config={CONFIG} tab="settings" adminServer={false} />,
      locale,
    );
    await userEvent.click(screen.getByRole('combobox', { name: text.pick }));
    await userEvent.click(await screen.findByText('# random'));
    await userEvent.click(screen.getByRole('button', { name: text.add }));

    expect(await screen.findByText(text.inUse)).toBeInTheDocument();
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('removes a channel', async () => {
    const fetchMock = setup(locale, () => ({ ...CONFIG, channels: [] }));
    await userEvent.click(await screen.findByRole('button', { name: text.removeGeneral }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${CHATBOT}/channels/${GENERAL}`, method: 'DELETE', body: undefined },
    ]);
  });

  it('asks for a key when the server has none of its own, and sends none until it is given', async () => {
    const fetchMock = setup(locale);
    await userEvent.type(screen.getByLabelText(text.baseUrl), 'https://example.com/v1');
    await userEvent.type(screen.getByLabelText(text.model), 'model-a');
    await userEvent.click(screen.getByRole('button', { name: text.llmSave }));

    expect(await screen.findByText(text.keyRequired)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('fetches the model list of the typed address from the server route and offers it', async () => {
    const fetchMock = setup(locale, () => ({ ok: true, models: ['model-b', 'model-a'] }));
    const button = screen.getByRole('button', { name: text.fetchModels });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(text.baseUrl), 'https://example.com/v1');
    expect(button).toBeEnabled();
    await userEvent.type(screen.getByLabelText(text.apiKey), 'k'.repeat(24));
    await userEvent.click(button);

    expect(await screen.findByText(text.twoModels)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      {
        path: `${CHATBOT}/llm/models`,
        method: 'POST',
        body: { baseUrl: 'https://example.com/v1', apiKey: 'k'.repeat(24) },
      },
    ]);
    await userEvent.type(screen.getByLabelText(text.model), 'model-a');
    // The list is also mirrored for assistive tech, so an id can appear twice.
    expect((await screen.findAllByText('model-a')).length).toBeGreaterThan(0);
  });

  it('asks for a key before fetching when the server has none of its own', async () => {
    const fetchMock = setup(locale);
    await userEvent.type(screen.getByLabelText(text.baseUrl), 'https://example.com/v1');
    await userEvent.click(screen.getByRole('button', { name: text.fetchModels }));

    expect(await screen.findByText(text.keyRequired)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('saves the server service and clears the key field afterwards', async () => {
    const fetchMock = setup(locale);
    await userEvent.type(screen.getByLabelText(text.baseUrl), 'https://example.com/v1');
    await userEvent.type(screen.getByLabelText(text.model), 'model-a');
    await userEvent.type(screen.getByLabelText(text.apiKey), 'k'.repeat(24));
    expect(screen.getByLabelText(text.apiKey)).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.click(screen.getByRole('button', { name: text.llmSave }));

    expect(await screen.findByText(text.llmSaved)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      {
        path: `${CHATBOT}/llm`,
        method: 'PUT',
        body: { baseUrl: 'https://example.com/v1', model: 'model-a', apiKey: 'k'.repeat(24) },
      },
    ]);
    expect(screen.getByLabelText(text.apiKey)).toHaveValue('');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('drops the server service only after the plan is shown and confirmed', async () => {
    const fetchMock = setup(locale, () => CONFIG, { ...CONFIG, llm: OWN_LLM });
    await userEvent.click(screen.getByRole('button', { name: text.useShared }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.useSharedPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.useSharedConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${CHATBOT}/llm`, method: 'DELETE', body: undefined },
    ]);
  });

  it('has nothing to drop while the shared service answers', () => {
    setup(locale);
    expect(screen.queryByRole('button', { name: text.useShared })).not.toBeInTheDocument();
  });

  it('counts the memory first and clears it only after the confirmation', async () => {
    const fetchMock = setup(locale, (_path, body) => ({
      dryRun: (body as { dryRun: boolean }).dryRun,
      userMemories: 3,
      channelMemories: 2,
    }));
    await userEvent.click(screen.getByRole('button', { name: text.clearAll }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.memoryPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([{ scope: 'all', dryRun: true }]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.memoryConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { scope: 'all', dryRun: true },
      { scope: 'all', dryRun: false },
    ]);
  });

  it('moves to another tab through the URL', async () => {
    setup(locale);
    await userEvent.click(screen.getByRole('tab', { name: text.usageTab }));
    expect(nav.push).toHaveBeenCalledWith('/servers/1/modules/chatbot?tab=usage');
  });
});
