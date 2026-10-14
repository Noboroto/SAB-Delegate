import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildSettings } from '@sab/shared';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { SettingsForm } from './settings-form';

const GUILD = '1'.repeat(18);
const CATEGORY = '2'.repeat(18);
const GENERAL = '3'.repeat(18);

const SETTINGS: GuildSettings = {
  introChannelId: null,
  logChannelId: null,
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  locale: 'vi',
};

const channels = [
  { id: CATEGORY, name: 'Chat', type: 4, parentId: null, position: 0 },
  { id: GENERAL, name: 'general', type: 0, parentId: CATEGORY, position: 1 },
];

function deferred() {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Answers the channel list; hands every PATCH to `onPatch`. */
function stubFetch(onPatch: (body: unknown) => Promise<Response>) {
  const patches: unknown[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
      patches.push(body);
      return onPatch(body);
    }
    expect(url).toContain('/discord/channels');
    return Promise.resolve(new Response(JSON.stringify(channels)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return patches;
}

const ok = (settings: GuildSettings) => Promise.resolve(new Response(JSON.stringify(settings)));

beforeEach(() => {
  refresh.mockReset();
});

describe('SettingsForm', () => {
  it('keeps save off until something changes', () => {
    stubFetch(() => ok(SETTINGS));
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />);
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  });

  it('sends only the changed field, then re-reads the page', async () => {
    const patches = stubFetch(() => ok({ ...SETTINGS, locale: 'en' }));
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByLabelText('Ngôn ngữ'));
    await userEvent.click(await screen.findByTitle('English'));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByText('Đã lưu cài đặt.')).toBeInTheDocument();
    expect(patches).toEqual([{ locale: 'en' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sends a picked channel by id', async () => {
    const patches = stubFetch(() => ok({ ...SETTINGS, logChannelId: GENERAL }));
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />, 'en');

    await userEvent.click(screen.getByLabelText('Log channel'));
    await userEvent.click(await screen.findByText('# general'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patches).toEqual([{ logChannelId: GENERAL }]));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });

  it('sends one request for a double submit', async () => {
    const gate = deferred();
    const patches = stubFetch(() => gate.promise);
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />, 'en');

    await userEvent.click(screen.getByLabelText('Language'));
    await userEvent.click(await screen.findByTitle('English'));
    const save = screen.getByRole('button', { name: 'Save changes' });
    await userEvent.dblClick(save);

    expect(patches).toHaveLength(1);
    gate.resolve(new Response(JSON.stringify({ ...SETTINGS, locale: 'en' })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the translated reason when the save fails and does not refresh', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 })),
    );
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />);

    await userEvent.click(screen.getByLabelText('Ngôn ngữ'));
    await userEvent.click(await screen.findByTitle('English'));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(
      await screen.findByText('Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.'),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps save off after a successful save until the refreshed settings arrive', async () => {
    const patches = stubFetch(() => ok({ ...SETTINGS, locale: 'en' }));
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />, 'en');

    await userEvent.click(screen.getByLabelText('Language'));
    await userEvent.click(await screen.findByTitle('English'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Settings saved.');

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(patches).toHaveLength(1);
  });

  it('re-reads the page when the answer to a save cannot be read', async () => {
    const patches = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ nope: true }))));
    renderWithProviders(<SettingsForm guildId={GUILD} settings={SETTINGS} />, 'en');

    await userEvent.click(screen.getByLabelText('Language'));
    await userEvent.click(await screen.findByTitle('English'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(patches).toHaveLength(1);
  });
});
