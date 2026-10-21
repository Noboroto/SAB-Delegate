import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_AVATAR_MAX_BYTES, type BotProfile } from '@sab/shared';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BotProfileForm } from './bot-profile-form';

const GUILD = '1'.repeat(18);
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PROFILE: BotProfile = { nick: 'Sabi', avatarUrl: null };

function pngFile() {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0));
  return new File([bytes], 'a.png', { type: 'image/png' });
}

function result(changes: Array<'nick' | 'avatar'>, profile: BotProfile) {
  return new Response(JSON.stringify({ dryRun: false, changes, profile }));
}

function stubFetch(answer: () => Promise<Response>) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
      return answer();
    }),
  );
  return bodies;
}

beforeEach(() => {
  refresh.mockReset();
});

describe('BotProfileForm', () => {
  it('sends only the nickname when only it changed', async () => {
    const bodies = stubFetch(() =>
      Promise.resolve(result(['nick'], { nick: 'Bé Sabi', avatarUrl: null })),
    );
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />);

    const input = screen.getByLabelText('Tên trên máy chủ này');
    await userEvent.clear(input);
    await userEvent.type(input, '  Bé Sabi ');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu tên và ảnh' }));

    expect(await screen.findByText('Đã cập nhật tên và ảnh của bot.')).toBeInTheDocument();
    expect(bodies).toEqual([{ nick: 'Bé Sabi' }]);
    expect(refresh).toHaveBeenCalled();
  });

  it('previews a chosen picture and sends it as base64 with the nickname untouched', async () => {
    const bodies = stubFetch(() => Promise.resolve(result(['avatar'], PROFILE)));
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />, 'en');

    expect(screen.getByRole('button', { name: 'Save name and picture' })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Choose a picture'), pngFile());
    expect(await screen.findByText('New picture (not saved yet)')).toBeInTheDocument();
    expect(document.querySelector(`img[src="data:image/png;base64,${PNG_BASE64}"]`)).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save name and picture' }));
    await waitFor(() => expect(bodies).toEqual([{ avatar: PNG_BASE64 }]));
    expect(await screen.findByText("The bot's name and picture are updated.")).toBeInTheDocument();
    expect(screen.queryByText('New picture (not saved yet)')).not.toBeInTheDocument();
  });

  it('rejects a picture over the limit without sending anything', async () => {
    const bodies = stubFetch(() => Promise.resolve(result([], PROFILE)));
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />, 'en');

    const big = new File([new Uint8Array(BOT_AVATAR_MAX_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    await userEvent.upload(screen.getByLabelText('Choose a picture'), big);

    expect(
      await screen.findByText('That picture is larger than 256 KB. Choose a smaller one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save name and picture' })).toBeDisabled();
    expect(bodies).toEqual([]);
  });

  it('rejects a file that is not a picture without sending anything', async () => {
    const bodies = stubFetch(() => Promise.resolve(result([], PROFILE)));
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />);

    const text = new File(['hello'], 'a.txt', { type: 'text/plain' });
    // The input's accept list would stop the browser's picker; the check must hold anyway.
    await userEvent.upload(screen.getByLabelText('Chọn ảnh'), text, { applyAccept: false });

    expect(
      await screen.findByText('Tệp này không phải ảnh PNG, JPEG hoặc GIF.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('sends one request for a double submit', async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const bodies = stubFetch(() => gate);
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />);

    await userEvent.type(screen.getByLabelText('Tên trên máy chủ này'), 'x');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Lưu tên và ảnh' }));
    expect(bodies).toHaveLength(1);
    release(result(['nick'], { nick: 'Sabix', avatarUrl: null }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('restores the bot name by clearing the nickname', async () => {
    const bodies = stubFetch(() =>
      Promise.resolve(result(['nick'], { nick: null, avatarUrl: null })),
    );
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />, 'en');

    await userEvent.click(screen.getByRole('button', { name: "Use the bot's own name" }));
    expect(await screen.findByText('The bot uses its own name again.')).toBeInTheDocument();
    expect(bodies).toEqual([{ nick: null }]);
  });

  it('restores the bot picture by sending a null avatar', async () => {
    const bodies = stubFetch(() =>
      Promise.resolve(result(['avatar'], { nick: 'Sabi', avatarUrl: null })),
    );
    renderWithProviders(
      <BotProfileForm
        guildId={GUILD}
        profile={{ nick: 'Sabi', avatarUrl: 'https://cdn.example.test/a.png' }}
      />,
      'en',
    );

    await userEvent.click(screen.getByRole('button', { name: "Use the bot's own picture" }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use own picture' }));
    expect(await screen.findByText('The bot uses its own picture again.')).toBeInTheDocument();
    // The service previews the change first; only the second call changes anything.
    expect(bodies).toEqual([
      { avatar: null, dryRun: true },
      { avatar: null, dryRun: false },
    ]);
  });

  it('keeps an unsaved nickname when the picture is restored, and a picked picture when the name is', async () => {
    stubFetch(() => Promise.resolve(result(['avatar'], { nick: 'Sabi', avatarUrl: null })));
    const { unmount } = renderWithProviders(
      <BotProfileForm
        guildId={GUILD}
        profile={{ nick: 'Sabi', avatarUrl: 'https://cdn.example.test/a.png' }}
      />,
      'en',
    );
    const input = screen.getByLabelText('Name on this server');
    await userEvent.clear(input);
    await userEvent.type(input, 'Draft');
    await userEvent.click(screen.getByRole('button', { name: "Use the bot's own picture" }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use own picture' }));
    await screen.findByText('The bot uses its own picture again.');
    expect(screen.getByLabelText('Name on this server')).toHaveValue('Draft');
    unmount();

    stubFetch(() => Promise.resolve(result(['nick'], { nick: null, avatarUrl: null })));
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />, 'en');
    await userEvent.upload(screen.getByLabelText('Choose a picture'), pngFile());
    expect(await screen.findByText('New picture (not saved yet)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Use the bot's own name" }));
    await screen.findByText('The bot uses its own name again.');
    expect(screen.getByText('New picture (not saved yet)')).toBeInTheDocument();
  });

  it('has no picture to restore when the bot already shows its own', () => {
    stubFetch(() => Promise.resolve(result([], PROFILE)));
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />);
    expect(screen.getByRole('button', { name: 'Dùng lại ảnh gốc của bot' })).toBeDisabled();
  });

  it('has nothing to restore when the bot already uses its own name', () => {
    stubFetch(() => Promise.resolve(result([], PROFILE)));
    renderWithProviders(
      <BotProfileForm guildId={GUILD} profile={{ nick: null, avatarUrl: null }} />,
    );
    expect(screen.getByRole('button', { name: 'Dùng lại tên gốc của bot' })).toBeDisabled();
  });

  it('shows the translated reason when Discord refuses the picture and still re-reads the page', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 })),
    );
    renderWithProviders(<BotProfileForm guildId={GUILD} profile={PROFILE} />);

    await userEvent.upload(screen.getByLabelText('Chọn ảnh'), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu tên và ảnh' }));

    expect(
      await screen.findByText('Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.'),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
