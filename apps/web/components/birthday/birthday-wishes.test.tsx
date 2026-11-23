import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BIRTHDAY_WISHES_MAX, type BirthdayWishView } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BirthdayWishes } from './birthday-wishes';

const GUILD = '1'.repeat(18);
const WISH_A = '11111111-1111-4111-8111-111111111111';
const WISH_B = '22222222-2222-4222-8222-222222222222';

const wish = (id: string, text: string, used = false): BirthdayWishView => ({ id, text, used });
const WISHES = [
  wish(WISH_A, 'Chúc ${name} vui <b>vẻ</b>\nhai dòng', true),
  wish(WISH_B, 'Hạnh phúc nhé ${name}!'),
];

// Slow enough that a second click lands while the first request is in flight.
const answer = (body: unknown, status = 200) =>
  new Promise<Response>((resolve) =>
    setTimeout(
      () =>
        resolve(
          status === 204
            ? new Response(null, { status })
            : new Response(JSON.stringify(body), { status }),
        ),
      40,
    ),
  );
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const typeInto = async (text: string) => {
  const box = screen.getByRole('textbox', { name: 'Nội dung lời chúc' });
  await userEvent.clear(box);
  // `{` opens a key descriptor in user-event, so it is doubled.
  await userEvent.type(box, text.replaceAll('{', '{{'));
};

describe('BirthdayWishes', () => {
  it.each(SUPPORTED_LOCALES)('renders the list in %s without bare keys', (locale) => {
    const { container } = renderWithProviders(
      <BirthdayWishes guildId={GUILD} wishes={WISHES} />,
      locale,
    );
    expect(
      screen.getByRole('button', { name: locale === 'vi' ? 'Thêm lời chúc' : 'Add a wish' }),
    ).toBeVisible();
    expect(container.textContent).not.toMatch(/web-birthday\./);
  });

  it('shows the text as text, marks the placeholder and flags a wish already sent', () => {
    const { container } = renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(screen.getByText(/Chúc/)).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getAllByText('Đã gửi trong vòng này')).toHaveLength(1);
    expect(screen.getByText('Đã có 2/200 lời chúc')).toBeVisible();
  });

  it('explains the built-in fallback and offers to add when the list is empty', async () => {
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Chưa có lời chúc nào' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('turns the add button off at the limit', () => {
    const many = Array.from({ length: BIRTHDAY_WISHES_MAX }, (_, index) =>
      wish(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, 'Chúc ${name}'),
    );
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={many} />);
    expect(screen.getByRole('button', { name: 'Thêm lời chúc' })).toBeDisabled();
    expect(screen.getByText(/Đã đạt tối đa 200 lời chúc/)).toBeVisible();
  });

  it('refuses a wish without the placeholder before calling the server', async () => {
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('Chúc mừng sinh nhật');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Nội dung lời chúc' })).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a wish that mentions the celebrant too often', async () => {
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('${name}'.repeat(6));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    expect(await screen.findByText(/tối đa 5 lần/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inserts the placeholder and previews the wish with a mention', async () => {
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('Chúc ');
    await userEvent.click(screen.getByRole('button', { name: 'Chèn ${name}' }));
    expect(screen.getByRole('textbox', { name: 'Nội dung lời chúc' })).toHaveValue('Chúc ${name}');
    expect(screen.getByLabelText('Xem trước')).toHaveTextContent('Chúc @Bạn');
  });

  it('adds a wish once even when the button is pressed twice, then refreshes', async () => {
    fetchMock.mockImplementation(() => answer(wish(WISH_A, 'Chúc ${name}!')));
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('  Chúc ${name}!  ');
    const save = screen.getByRole('button', { name: 'Lưu lời chúc' });
    await userEvent.dblClick(save);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/guilds/${GUILD}/birthday-wishes`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      text: 'Chúc ${name}!',
    });
  });

  it('edits a wish through PATCH on its id', async () => {
    fetchMock.mockImplementation(() => answer(wish(WISH_B, 'Mới ${name}')));
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sửa lời chúc 2' }));
    expect(screen.getByRole('textbox', { name: 'Nội dung lời chúc' })).toHaveValue(
      'Hạnh phúc nhé ${name}!',
    );
    await typeInto('Mới ${name}');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/guilds/${GUILD}/birthday-wishes/${WISH_B}`);
    expect(init?.method).toBe('PATCH');
  });

  it('closes a new wish whose save had no readable answer, so it is not sent twice', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('network down')));
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('Chúc ${name}!');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // The modal's closing animation never finishes in happy-dom, so the warning is what is checked.
    expect(await screen.findByText(/Không rõ lời chúc đã được lưu chưa/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-reads the list when the wish being edited was removed meanwhile', async () => {
    fetchMock.mockImplementation(() => answer({ code: 'BIRTHDAY_WISH_NOT_FOUND' }, 404));
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sửa lời chúc 2' }));
    await typeInto('Mới ${name}');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the translated server error and keeps the form open', async () => {
    fetchMock.mockImplementation(() =>
      answer({ code: 'BIRTHDAY_WISH_LIMIT_REACHED', details: { max: 200 } }, 409),
    );
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lời chúc' }));
    await typeInto('Chúc ${name}!');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lời chúc' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa (200)');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('deletes only after the person confirms, and accepts the empty 204 answer', async () => {
    fetchMock.mockImplementation(() => answer(null, 204));
    renderWithProviders(<BirthdayWishes guildId={GUILD} wishes={WISHES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Xoá lời chúc 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/guilds/${GUILD}/birthday-wishes/${WISH_A}`);
    expect(init?.method).toBe('DELETE');
    expect(await screen.findByText('Đã xoá lời chúc.')).toBeVisible();
  });
});
