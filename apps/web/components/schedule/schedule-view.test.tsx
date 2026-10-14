import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { GENERAL, GUILD, deferred, stubApi, writesOf } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import type { ScheduledRow } from '@/lib/schedule/schedule-api';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

import { ScheduleView } from './schedule-view';

const row: ScheduledRow = {
  id: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  seq: 3,
  kind: 'SEND',
  runAt: new Date('2026-10-20T02:30:00Z'),
  status: 'PENDING',
  attempts: 0,
  source: 'HTTP',
  createdAt: new Date('2026-10-14T05:00:00Z'),
  channelId: GENERAL,
  content: 'Nhắc họp tối nay',
  sourceChannelId: null,
  sourceMessageId: null,
  createdByUserId: '5'.repeat(18),
  lastError: null,
  allowedMentions: { parse: [] },
};

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    channel: 'Kênh',
    content: 'Nội dung',
    date: 'Ngày',
    time: 'Giờ',
    action: 'Hẹn giờ gửi',
    channelRequired: 'Hãy chọn kênh.',
    timeRequired: 'Hãy nhập giờ gửi.',
    nonexistentDate: 'Ngày này không có trong lịch.',
    past: 'Thời điểm này đã qua. Hãy chọn một lúc trong tương lai.',
    tableTitle: 'Đang chờ gửi (1)',
    empty: 'Chưa có tin nào đang chờ. Hẹn một tin bằng biểu mẫu bên cạnh.',
    cancel: 'Huỷ lịch 3',
    cancelConfirm: 'Huỷ lịch này',
    cancelPlan: 'Lịch số 3 sẽ bị huỷ và tin nhắn sẽ không được gửi.',
    notPending: 'Lịch số 3 đã gửi, đã lỗi hoặc đang được gửi nên không huỷ được.',
    done: /Đã hẹn gửi lúc .* 09:30\./,
  },
  en: {
    channel: 'Channel',
    content: 'Message text',
    date: 'Date',
    time: 'Time',
    action: 'Schedule',
    channelRequired: 'Choose a channel.',
    timeRequired: 'Enter the time to send.',
    nonexistentDate: 'This day is not on the calendar.',
    past: 'This moment has already passed. Choose a time in the future.',
    tableTitle: 'Waiting to be sent (1)',
    empty: 'Nothing is waiting. Schedule a message with the form beside this list.',
    cancel: 'Cancel schedule 3',
    cancelConfirm: 'Cancel this schedule',
    cancelPlan: 'Schedule 3 will be canceled and its message will not be sent.',
    notPending: 'Schedule 3 was already sent, failed or is being sent, so it cannot be canceled.',
    done: /Scheduled for .* 09:30\./,
  },
} as const;

beforeEach(() => {
  nav.refresh.mockReset();
});

const cancelPlan = (path: string, code = 'CANCELED') => ({
  dryRun: path.includes('dryRun=true'),
  code,
  seq: 3,
  status: 'PENDING',
});

describe.each(SUPPORTED_LOCALES)('ScheduleView (%s)', (locale) => {
  const text = TEXT[locale];

  async function chooseChannel() {
    await userEvent.click(screen.getByLabelText(text.channel));
    await userEvent.click(await screen.findByText('# general'));
  }

  it('hints the order of the date and the time in the visitor language', () => {
    stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    const hints = {
      vi: ['ngày/tháng/năm, ví dụ 25/10/2026', 'giờ:phút, ví dụ 21:30'],
      en: ['day/month/year, e.g. 25/10/2026', 'hours:minutes, e.g. 21:30'],
    } as const;
    expect(screen.getByLabelText(text.date)).toHaveAttribute('placeholder', hints[locale][0]);
    expect(screen.getByLabelText(text.time)).toHaveAttribute('placeholder', hints[locale][1]);
  });

  it('lists what is waiting with the time in the business zone', () => {
    stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[row]} />, locale);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(text.tableTitle)).toBeInTheDocument();
    expect(screen.getByText('Nhắc họp tối nay')).toBeInTheDocument();
    expect(screen.getByText(/09:30/)).toHaveAttribute('datetime', '2026-10-20T02:30:00.000Z');
    expect(document.body.textContent).not.toMatch(/web-schedule|table\.\w|create\.\w/);
  });

  it('points to the form when nothing is waiting', () => {
    stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    expect(screen.getByText(text.empty)).toBeInTheDocument();
  });

  it('asks for a channel before anything is sent', async () => {
    const fetchMock = stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.type(screen.getByLabelText(text.time), '10:00');
    await userEvent.click(screen.getByRole('button', { name: text.action }));

    expect(await screen.findByText(text.channelRequired)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('asks for the time before anything is sent', async () => {
    const fetchMock = stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await chooseChannel();
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.click(screen.getByRole('button', { name: text.action }));

    expect(await screen.findByText(text.timeRequired)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('refuses a day that is not on the calendar', async () => {
    const fetchMock = stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await chooseChannel();
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.type(screen.getByLabelText(text.date), '31/02');
    await userEvent.type(screen.getByLabelText(text.time), '10:00');
    await userEvent.click(screen.getByRole('button', { name: text.action }));

    expect(await screen.findByText(text.nonexistentDate)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('refuses a moment that has passed', async () => {
    const fetchMock = stubApi(() => ({}));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await chooseChannel();
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.type(screen.getByLabelText(text.date), '01/01/2020');
    await userEvent.type(screen.getByLabelText(text.time), '09:00');
    await userEvent.click(screen.getByRole('button', { name: text.action }));

    expect(await screen.findByText(text.past)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it('schedules once, with the time as ISO text in +07:00', async () => {
    const gate = deferred<unknown>();
    const fetchMock = stubApi(() => gate.promise);
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await chooseChannel();
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.type(screen.getByLabelText(text.date), 'tomorrow');
    await userEvent.type(screen.getByLabelText(text.time), '09:30');
    await userEvent.dblClick(screen.getByRole('button', { name: text.action }));

    gate.resolve({
      dryRun: false,
      kind: 'SEND',
      channelId: GENERAL,
      runAt: '2026-10-21T02:30:00.000Z',
      content: 'Nhắc họp',
      attachmentCount: 0,
      allowedMentions: { parse: [] },
      schedule: null,
    });
    expect(await screen.findByText(text.done)).toBeInTheDocument();
    expect(nav.refresh).toHaveBeenCalledTimes(1);

    const writes = writesOf(fetchMock);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: `/api/guilds/${GUILD}/schedules`,
      method: 'POST',
      body: {
        kind: 'send',
        channelId: GENERAL,
        content: 'Nhắc họp',
        runAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:30:00\+07:00$/) as unknown,
        dryRun: false,
      },
    });
  });

  it('re-reads the list when the answer to a schedule cannot be read, so a retry cannot duplicate', async () => {
    const fetchMock = stubApi(() => ({ unexpected: true }));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[]} />, locale);
    await chooseChannel();
    await userEvent.type(screen.getByLabelText(text.content), 'Nhắc họp');
    await userEvent.type(screen.getByLabelText(text.date), 'tomorrow');
    await userEvent.type(screen.getByLabelText(text.time), '09:30');
    await userEvent.click(screen.getByRole('button', { name: text.action }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toHaveLength(1);
  });

  it('cancels only after the service has said what the cancel does', async () => {
    const fetchMock = stubApi((path) => cancelPlan(path));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[row]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: text.cancel }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.cancelPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      { path: `/api/guilds/${GUILD}/schedules/3?dryRun=true`, method: 'DELETE', body: undefined },
    ]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.cancelConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.path)).toEqual([
      `/api/guilds/${GUILD}/schedules/3?dryRun=true`,
      `/api/guilds/${GUILD}/schedules/3?confirm=true`,
    ]);
  });

  it('will not confirm a cancel the service says cannot happen', async () => {
    stubApi((path) => cancelPlan(path, 'NOT_PENDING'));
    renderWithProviders(<ScheduleView guildId={GUILD} rows={[row]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: text.cancel }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.notPending)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: text.cancelConfirm })).toBeDisabled();
  });
});
