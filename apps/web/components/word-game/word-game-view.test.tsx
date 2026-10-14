import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordGameInfo, WordGameWordsPage } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { GENERAL, GUILD, RANDOM, bodyOf, stubApi, writesOf } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/word-game',
}));

import { WordGameView } from './word-game-view';

const info: WordGameInfo = {
  started: true,
  lastWord: 'xin',
  lastUserId: '5'.repeat(18),
  channelId: GENERAL,
  maxWords: 400,
  count: 300,
  finished: false,
};
const words: WordGameWordsPage = {
  items: [{ word: 'xin' }, { word: 'chào' }],
  pagination: { page: 1, pageSize: 20, total: 2 },
};
const query = { page: 1, pageSize: 20, sort: 'played', order: 'asc' } as const;

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    status: 'Vòng hiện tại',
    count: '300 / 400 từ',
    save: 'Lưu',
    maxWords: 'Số từ tối đa mỗi vòng',
    channel: 'Kênh chơi',
    saveNewRound: 'Lưu và bắt đầu vòng mới',
    confirmNewRound: 'Đổi kênh và xoá từ',
    configPlan: 'Vòng mới bắt đầu ở kênh đã chọn, 300 từ đã dùng sẽ bị xoá.',
    reset: 'Bắt đầu lại vòng',
    resetConfirm: 'Xoá từ và bắt đầu lại',
    resetPlan: '300 từ đã dùng sẽ bị xoá và vòng chơi bắt đầu lại từ đầu.',
    wordsTitle: 'Các từ đã dùng (2)',
  },
  en: {
    status: 'Current round',
    count: '300 / 400 words',
    save: 'Save',
    maxWords: 'Words allowed per round',
    channel: 'Game channel',
    saveNewRound: 'Save and start a new round',
    confirmNewRound: 'Change channel and clear words',
    configPlan: 'A new round starts in the chosen channel and 300 used words will be cleared.',
    reset: 'Start the round over',
    resetConfirm: 'Clear the words and start over',
    resetPlan: '300 used words will be cleared and the round starts again from the beginning.',
    wordsTitle: 'Words used (2)',
  },
} as const;

const configResult = {
  before: { channelId: GENERAL, maxWords: 400 },
  after: { channelId: RANDOM, maxWords: 400 },
  restarted: true,
  clearedWords: 300,
  sample: ['xin'],
  dryRun: true,
};

function setup(
  locale: 'vi' | 'en',
  handler: (path: string, body: unknown) => unknown = () => ({}),
) {
  const fetchMock = stubApi((path, init) => handler(path, bodyOf(init)));
  renderWithProviders(
    <WordGameView guildId={GUILD} info={info} words={words} query={query} />,
    locale,
  );
  return fetchMock;
}

beforeEach(() => {
  nav.refresh.mockReset();
  nav.push.mockReset();
});

describe.each(SUPPORTED_LOCALES)('WordGameView (%s)', (locale) => {
  const text = TEXT[locale];

  it('shows the round, the settings and the used words in plain language', async () => {
    setup(locale);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(text.status)).toBeInTheDocument();
    expect(screen.getByText(text.count)).toBeInTheDocument();
    expect(screen.getByText(text.wordsTitle)).toBeInTheDocument();
    expect(screen.getByText('chào')).toBeInTheDocument();
    expect(await screen.findAllByText('# general')).not.toHaveLength(0);
    // A missing translation shows as its key path.
    expect(document.body.textContent).not.toMatch(/web-word-game|status\.\w|config\.\w|words\.\w/);
  });

  it('keeps save off until something changed, then saves the limit alone straight away', async () => {
    const fetchMock = setup(locale, () => ({ ...configResult, restarted: false, dryRun: false }));
    const save = screen.getByRole('button', { name: text.save });
    expect(save).toBeDisabled();

    const input = screen.getByLabelText(text.maxWords);
    await userEvent.clear(input);
    await userEvent.type(input, '500');
    await userEvent.click(save);

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      {
        path: `/api/guilds/${GUILD}/word-game/config`,
        method: 'PATCH',
        body: { maxWords: 500, dryRun: false },
      },
    ]);
  });

  it('shows what a new channel clears and changes nothing until it is confirmed', async () => {
    const fetchMock = setup(locale, (_path, body) => ({
      ...configResult,
      dryRun: (body as { dryRun: boolean }).dryRun,
    }));
    await userEvent.click(screen.getByLabelText(text.channel));
    await userEvent.click(await screen.findByText('# random'));
    await userEvent.click(screen.getByRole('button', { name: text.saveNewRound }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.configPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { channelId: RANDOM, dryRun: true },
    ]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.confirmNewRound }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { channelId: RANDOM, dryRun: true },
      { channelId: RANDOM, dryRun: false },
    ]);
  });

  it('resets the round only after the service has reported what it clears', async () => {
    const fetchMock = setup(locale, (_path, body) => ({
      status: 'RESET',
      channelId: GENERAL,
      clearedWords: 300,
      sample: ['xin', 'chào'],
      dryRun: (body as { dryRun: boolean }).dryRun,
    }));
    await userEvent.click(screen.getByRole('button', { name: text.reset }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.resetPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toHaveLength(1);
    expect(writesOf(fetchMock)[0]).toMatchObject({
      path: `/api/guilds/${GUILD}/word-game/reset`,
      body: { dryRun: true, confirm: false },
    });

    await userEvent.click(within(dialog).getByRole('button', { name: text.resetConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)[1]).toMatchObject({ body: { dryRun: false, confirm: true } });
  });

  it('moves to the chosen page through the URL', async () => {
    const paged = { ...words, pagination: { page: 1, pageSize: 20, total: 45 } };
    stubApi(() => ({}));
    renderWithProviders(
      <WordGameView guildId={GUILD} info={info} words={paged} query={query} />,
      locale,
    );
    await userEvent.click(screen.getByTitle('2'));
    expect(nav.push).toHaveBeenCalledWith(
      '/servers/1/modules/word-game?page=2&pageSize=20&sort=played&order=asc',
    );
  });
});
