import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
// The picker has its own tests; here it stands in as a plain field that reports an id.
vi.mock('@/components/forms/member-select', () => ({
  MemberSelect: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value?: string | null;
    onChange?: (value: string | undefined) => void;
  }) => <input id={id} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} />,
}));

import { BirthdayAddForm } from './birthday-add-form';

const GUILD = '1'.repeat(18);
const MEMBER = '2'.repeat(18);

const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

async function fill(day: string, month: string) {
  await userEvent.type(screen.getByLabelText('Mã số'), 'SE123');
  await userEvent.type(screen.getByLabelText('Tên'), 'Nguyen Van A');
  await userEvent.type(screen.getByLabelText('Tài khoản Discord'), MEMBER);
  await userEvent.type(screen.getByLabelText('Ngày'), day);
  await userEvent.type(screen.getByLabelText('Tháng'), month);
}

const submit = () => screen.getByRole('button', { name: 'Thêm vào danh sách' });

describe('BirthdayAddForm', () => {
  it.each(SUPPORTED_LOCALES)('renders its text in %s without bare keys', (locale) => {
    const { container } = renderWithProviders(<BirthdayAddForm guildId={GUILD} />, locale);
    expect(container.textContent).not.toMatch(/web-birthday\./);
    expect(screen.getByText(locale === 'vi' ? 'Thêm một người' : 'Add one person')).toBeVisible();
  });

  it('refuses an empty form before any request', async () => {
    renderWithProviders(<BirthdayAddForm guildId={GUILD} />);
    await userEvent.click(submit());
    expect((await screen.findAllByText('Mục này không được để trống.')).length).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a day that is not on the calendar before any request', async () => {
    renderWithProviders(<BirthdayAddForm guildId={GUILD} />);
    await fill('31', '2');
    await userEvent.click(submit());
    expect(await screen.findByText('Ngày và tháng này không có trong lịch.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the person once however often the button is pressed, then refreshes', async () => {
    fetchMock.mockImplementation(() => answer({ code: 'ADDED' }));
    renderWithProviders(<BirthdayAddForm guildId={GUILD} />);
    await fill('15', '3');
    await userEvent.dblClick(submit());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/guilds/${GUILD}/birthdays`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      studentId: 'SE123',
      name: 'Nguyen Van A',
      discordId: MEMBER,
      month: 3,
      day: 15,
    });
  });

  it('says so when the student ID is already on the list', async () => {
    fetchMock.mockImplementation(() => answer({ code: 'DUPLICATE_ID' }));
    renderWithProviders(<BirthdayAddForm guildId={GUILD} />);
    await fill('15', '3');
    await userEvent.click(submit());
    expect(await screen.findByText('Mã số này đã có trong danh sách.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows the translated reason when the server refuses', async () => {
    fetchMock.mockImplementation(() => answer({ code: 'GUILD_ACCESS_DENIED' }, 403));
    renderWithProviders(<BirthdayAddForm guildId={GUILD} />);
    await fill('15', '3');
    await userEvent.click(submit());
    expect(await screen.findByText('Bạn không có quyền quản lý máy chủ này.')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });
});
