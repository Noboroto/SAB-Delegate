import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BIRTHDAY_CSV_TEMPLATE } from '@sab/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BirthdayImport } from './birthday-import';

const GUILD = '1'.repeat(18);
const CSV = 'Name,ID,DiscordID,Day,Month\nAn,SE1,222222222222222222,15,3\n';

const DRY_REPORT = {
  dryRun: true,
  total: 4,
  added: 2,
  duplicates: ['SE9'],
  sample: ['An', 'Binh'],
  problems: [{ row: 4, kind: 'INVALID_DATE', studentId: 'SE4' }],
};

const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const bodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown);

function pickFile(label = 'Tệp CSV sinh nhật') {
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: [new File([CSV], 'birthdays.csv', { type: 'text/csv' })] },
  });
}

describe('BirthdayImport', () => {
  it.each(SUPPORTED_LOCALES)('renders its text in %s without bare keys', (locale) => {
    const { container } = renderWithProviders(<BirthdayImport guildId={GUILD} />, locale);
    expect(container.textContent).not.toMatch(/web-birthday\./);
    expect(container.textContent).toContain('Name, ID, DiscordID, Day, Month');
  });

  it('keeps the check off until a file is chosen', () => {
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    expect(screen.getByRole('button', { name: 'Kiểm tra tệp' })).toBeDisabled();
  });

  it('shows what the service would add, skip and refuse before anything is imported', async () => {
    fetchMock.mockImplementation(() => answer(DRY_REPORT));
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    pickFile();
    expect(await screen.findByText('birthdays.csv')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra tệp' }));

    expect(await screen.findByText('Sẽ thêm: 2')).toBeVisible();
    expect(screen.getByText('Bỏ qua vì mã số đã có: 1')).toBeVisible();
    expect(screen.getByText('Dòng không dùng được: 1')).toBeVisible();
    expect(screen.getByText('Ngày hoặc tháng không có trong lịch')).toBeVisible();
    expect(screen.getByText('SE4')).toBeVisible();
    expect(bodies()).toEqual([{ csv: CSV, dryRun: true }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/guilds/${GUILD}/birthdays/import`);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('imports once after the preview, however often confirm is pressed', async () => {
    fetchMock.mockImplementation((_url, init) =>
      answer(
        (JSON.parse(init?.body as string) as { dryRun: boolean }).dryRun
          ? DRY_REPORT
          : { ...DRY_REPORT, dryRun: false },
      ),
    );
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    pickFile();
    await screen.findByText('birthdays.csv');
    expect(screen.queryByRole('button', { name: 'Nhập 2 người' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra tệp' }));
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Nhập 2 người' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(bodies()).toEqual([
      { csv: CSV, dryRun: true },
      { csv: CSV, dryRun: false },
    ]);
  });

  it('offers no import when the service finds nobody new', async () => {
    fetchMock.mockImplementation(() => answer({ ...DRY_REPORT, added: 0, sample: [] }));
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    pickFile();
    await screen.findByText('birthdays.csv');
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra tệp' }));
    expect(await screen.findByText('Không có ai mới để thêm.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Nhập / })).not.toBeInTheDocument();
  });

  it('shows the expected template when the file is rejected', async () => {
    fetchMock.mockImplementation(() => answer({ code: 'VALIDATION_FAILED' }, 400));
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    pickFile();
    await screen.findByText('birthdays.csv');
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra tệp' }));

    expect(await screen.findByText('Tệp CSV không đúng mẫu')).toBeVisible();
    expect(screen.getByText(/^Name,ID,DiscordID,Day,Month/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Nhập / })).not.toBeInTheDocument();
  });

  it('downloads a template built from the shared header', async () => {
    const create = vi.fn(() => 'blob:template');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderWithProviders(<BirthdayImport guildId={GUILD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tải tệp mẫu' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:template');
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe(BIRTHDAY_CSV_TEMPLATE);
    click.mockRestore();
  });
});
