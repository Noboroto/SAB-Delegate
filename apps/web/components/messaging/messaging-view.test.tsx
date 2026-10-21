import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import {
  GENERAL,
  GUILD,
  MESSAGE_LINK,
  bodyOf,
  deferred,
  stubApi,
  writesOf,
} from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.search,
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/messaging',
}));

import { UnsavedGuardProvider } from '@/components/forms/unsaved-guard';
import { MessagingView } from './messaging-view';

const MESSAGE = '7'.repeat(18);

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    tabs: ['Gửi tin', 'Sao chép tin', 'Thả biểu cảm', 'Bình chọn', 'Sửa tin của bot'],
    channel: 'Kênh',
    content: 'Nội dung',
    reply: 'Trả lời một tin nhắn (không bắt buộc)',
    badLink: 'Đây không phải liên kết tin nhắn Discord.',
    sendAction: 'Xem trước và gửi',
    sendConfirm: 'Gửi tin',
    preview: 'Kế hoạch sẽ thực hiện',
  },
  en: {
    tabs: ['Send', 'Copy', 'React', 'Poll', 'Edit bot message'],
    channel: 'Channel',
    content: 'Message text',
    reply: 'Reply to a message (optional)',
    badLink: 'This is not a Discord message link.',
    sendAction: 'Preview and send',
    sendConfirm: 'Send message',
    preview: 'What will happen',
  },
} as const;

beforeEach(() => {
  nav.refresh.mockReset();
  nav.replace.mockReset();
  nav.search = new URLSearchParams();
});

const sendPlan = (dryRun: boolean) => ({
  channelId: GENERAL,
  messageId: dryRun ? null : MESSAGE,
  replyToMessageId: null,
  content: 'Xin chào cả nhà',
  pings: [],
  dryRun,
});

describe.each(SUPPORTED_LOCALES)('MessagingView (%s)', (locale) => {
  const text = TEXT[locale];

  it('offers the five forms as tabs and keeps the chosen one in the URL', async () => {
    stubApi(() => ({}));
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="send" />, locale);
    for (const name of text.tabs) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('tab', { name: text.tabs[3] }));
    expect(nav.replace).toHaveBeenCalledWith('/servers/1/modules/messaging?tab=poll', {
      scroll: false,
    });
    expect(document.body.textContent).not.toMatch(/web-messaging|tabs\./);
  });

  it('sends only after the service has previewed the message and the person confirmed', async () => {
    const fetchMock = stubApi((_path, init) => {
      const body = bodyOf(init) as { dryRun: boolean };
      return sendPlan(body.dryRun);
    });
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="send" />, locale);

    const action = screen.getByRole('button', { name: text.sendAction });
    expect(action).toBeDisabled();

    await userEvent.click(screen.getByLabelText(text.channel));
    await userEvent.click(await screen.findByText('# general'));
    await userEvent.type(screen.getByLabelText(text.content), 'Xin chào cả nhà');
    await userEvent.click(action);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Xin chào cả nhà')).toBeInTheDocument();
    expect(within(dialog).getByText(text.preview)).toBeInTheDocument();
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { channelId: GENERAL, content: 'Xin chào cả nhà', dryRun: true },
    ]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.sendConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { channelId: GENERAL, content: 'Xin chào cả nhà', dryRun: true },
      { channelId: GENERAL, content: 'Xin chào cả nhà', dryRun: false },
    ]);
    expect(writesOf(fetchMock)[1]).toMatchObject({
      path: `/api/guilds/${GUILD}/messages/send`,
      method: 'POST',
    });
  });

  it('says what is wrong with a reply link and keeps the action off', async () => {
    stubApi(() => ({}));
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="send" />, locale);
    await userEvent.type(screen.getByLabelText(text.reply), 'not a link');
    expect(await screen.findByText(text.badLink)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.sendAction })).toBeDisabled();
  });
});

describe('the tab in the address (vi)', () => {
  it('shows the tab the URL names, whatever the page was rendered with', () => {
    stubApi(() => ({}));
    nav.search = new URLSearchParams('tab=poll');
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="send" />);
    expect(screen.getByRole('tab', { name: 'Bình chọn', selected: true })).toBeInTheDocument();
  });

  it('asks before leaving a tab that holds typed text', async () => {
    stubApi(() => ({}));
    renderWithProviders(
      <UnsavedGuardProvider>
        <MessagingView guildId={GUILD} initialTab="send" />
      </UnsavedGuardProvider>,
    );
    await userEvent.type(screen.getByLabelText('Nội dung'), 'dở dang');
    await userEvent.click(screen.getByRole('tab', { name: 'Bình chọn' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe('the other forms (vi)', () => {
  it('copies with one request however many times the button is pressed', async () => {
    const gate = deferred<unknown>();
    const fetchMock = stubApi(() => gate.promise);
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="copy" />);

    await userEvent.type(screen.getByLabelText('Tin nhắn cần sao chép'), MESSAGE_LINK);
    await userEvent.click(screen.getByLabelText('Kênh nhận bản sao'));
    await userEvent.click(await screen.findByText('# general'));
    const button = screen.getByRole('button', { name: 'Sao chép tin' });
    await userEvent.dblClick(button);

    gate.resolve({ status: 'COPIED', channelId: GENERAL, messageId: MESSAGE });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      {
        path: `/api/guilds/${GUILD}/messages/copy`,
        method: 'POST',
        body: { source: { channelId: GENERAL, messageId: MESSAGE }, channelId: GENERAL },
      },
    ]);
  });

  it('adds reactions in one call', async () => {
    const fetchMock = stubApi(() => ({ channelId: GENERAL, messageId: MESSAGE, count: 4 }));
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="react" />);

    await userEvent.type(screen.getByLabelText('Tin nhắn'), MESSAGE_LINK);
    await userEvent.type(screen.getByLabelText('Biểu cảm'), '✅');
    await userEvent.click(screen.getByRole('button', { name: 'Thả biểu cảm' }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)[0]).toMatchObject({
      path: `/api/guilds/${GUILD}/messages/react`,
      body: { target: { channelId: GENERAL, messageId: MESSAGE }, emoji: '✅', pollChoices: 0 },
    });
  });

  it('previews a poll before creating it', async () => {
    const fetchMock = stubApi((_path, init) => ({
      channelId: GENERAL,
      messageId: null,
      created: true,
      emojis: ['1️⃣', '2️⃣'],
      dryRun: (bodyOf(init) as { dryRun: boolean }).dryRun,
    }));
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="poll" />);

    await userEvent.click(screen.getByLabelText('Kênh'));
    await userEvent.click(await screen.findByText('# general'));
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và tạo bình chọn' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1️⃣ 2️⃣')).toBeInTheDocument();
    expect(writesOf(fetchMock)).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Tạo bình chọn' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { channelId: GENERAL, choices: 2, dryRun: true },
      { channelId: GENERAL, choices: 2, dryRun: false },
    ]);
  });

  it('will not confirm an edit of a message the bot did not post', async () => {
    const fetchMock = stubApi(() => ({
      status: 'NOT_BOT_MESSAGE',
      channelId: GENERAL,
      messageId: MESSAGE,
      content: null,
      dryRun: true,
    }));
    renderWithProviders(<MessagingView guildId={GUILD} initialTab="edit" />);

    await userEvent.type(screen.getByLabelText('Tin nhắn của bot cần sửa'), MESSAGE_LINK);
    await userEvent.type(screen.getByLabelText('Nội dung mới'), 'Sửa lại');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và sửa' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Đây không phải tin nhắn do bot đăng nên không sửa được.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sửa tin' })).toBeDisabled();
    expect(writesOf(fetchMock)).toEqual([
      {
        path: `/api/guilds/${GUILD}/messages/${GENERAL}/${MESSAGE}`,
        method: 'PATCH',
        body: { content: 'Sửa lại', dryRun: true },
      },
    ]);
  });
});
