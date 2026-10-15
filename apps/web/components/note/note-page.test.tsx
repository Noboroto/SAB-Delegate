import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import type { NoteView } from '@/lib/note/note-schemas';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { NotePage } from './note-page';

const GUILD = '1'.repeat(18);
const MOD = '2'.repeat(18);
const HELPER = '3'.repeat(18);
const GONE = '4'.repeat(18);

const ROLES = [
  { id: MOD, name: 'Moderator', color: 0, position: 2, managed: false },
  { id: HELPER, name: 'Helper', color: 0, position: 1, managed: false },
];

const note = (roleId: string, topic: string, content: string): NoteView => ({
  roleId,
  topic,
  content,
  updatedAt: new Date('2026-10-14T05:00:00Z'),
});

const NOTES = [
  note(HELPER, 'Rules', 'Be kind'),
  note(MOD, 'Zeta', 'last'),
  note(MOD, 'Alpha', 'first <b>bold</b>\nsecond line'),
  note(GONE, 'Orphan', 'x'),
];

// Slow enough that a second click lands while the first request is in flight.
const answer = (body: unknown, status = 200) =>
  new Promise<Response>((resolve) =>
    setTimeout(() => resolve(new Response(JSON.stringify(body), { status })), 40),
  );
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined) {
  fetchMock.mockImplementation(
    (url, init) =>
      extra(url, init) ??
      (url.endsWith('/discord/roles') ? answer(ROLES) : answer({ code: 'INTERNAL_ERROR' }, 500)),
  );
}

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const writes = () => fetchMock.mock.calls.filter(([url]) => !url.endsWith('/discord/roles'));

describe('NotePage', () => {
  it.each(SUPPORTED_LOCALES)('renders in %s without bare keys', async (locale) => {
    serve(() => undefined);
    const { container } = renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />, locale);
    expect(
      screen.getByRole('heading', { level: 1, name: locale === 'vi' ? 'Ghi chú' : 'Notes' }),
    ).toBeVisible();
    await screen.findByText('Moderator');
    expect(container.textContent).not.toMatch(/web-note\./);
  });

  it('groups notes under their role, in role order, with topics sorted', async () => {
    serve(() => undefined);
    renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await screen.findByText('Moderator');
    const roleHeadings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent ?? '');
    expect(roleHeadings[0]).toContain('Moderator');
    expect(roleHeadings[1]).toContain('Helper');
    expect(roleHeadings[2]).toContain(`Vai trò không còn trong máy chủ (${GONE})`);
    const topics = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(topics).toEqual(['Alpha', 'Zeta', 'Rules', 'Orphan']);
  });

  it('shows the text as text, never as markup', async () => {
    serve(() => undefined);
    const { container } = renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await screen.findByText('Moderator');
    expect(container.querySelector('article b')).toBeNull();
    expect(container.textContent).toContain('first <b>bold</b>');
  });

  it('says so when there are no notes', async () => {
    serve(() => undefined);
    renderWithProviders(<NotePage guildId={GUILD} notes={[]} />);
    expect(await screen.findByText('Chưa có ghi chú nào')).toBeVisible();
  });

  it('refuses a new note before any request when its topic is empty', async () => {
    serve(() => undefined);
    renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu ghi chú' }));
    // AntD validates the fields one after another; under load the first match
    // can land before the third message renders, so wait for all three.
    await waitFor(() =>
      expect(within(dialog).getAllByText('Mục này không được để trống.')).toHaveLength(3),
    );
    expect(writes()).toHaveLength(0);
  });

  it('edits the text with one PATCH however often save is pressed, then refreshes', async () => {
    serve((_url, init) =>
      init?.method === 'PATCH'
        ? answer({
            roleId: MOD,
            topic: 'Zeta',
            content: 'changed',
            updatedAt: '2026-10-14T06:00:00Z',
          })
        : undefined,
    );
    renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sửa ghi chú Zeta' }));
    const dialog = await screen.findByRole('dialog');
    const content = within(dialog).getByLabelText('Nội dung');
    await userEvent.clear(content);
    await userEvent.type(content, 'changed');
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Lưu ghi chú' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(writes()).toHaveLength(1);
    const [url, init] = writes()[0] ?? [];
    expect(url).toBe(`/api/guilds/${GUILD}/notes`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({
      roleId: MOD,
      topic: 'Zeta',
      content: 'changed',
    });
  });

  it('deletes only after the service has shown the plan and the person confirmed it', async () => {
    serve((url, init) => {
      if (init?.method !== 'DELETE') return undefined;
      return answer(
        url.includes('dryRun=true')
          ? { count: 1, sample: [{ roleId: HELPER, topic: 'Rules' }] }
          : { count: 1 },
      );
    });
    renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ghi chú Rules' }));
    expect(await screen.findByText('Sẽ xoá 1 ghi chú:')).toBeInTheDocument();
    expect(writes().map(([url]) => url)).toEqual([
      `/api/guilds/${GUILD}/notes?roleId=${HELPER}&topic=Rules&dryRun=true`,
    ]);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(writes().map(([url]) => url)).toEqual([
      `/api/guilds/${GUILD}/notes?roleId=${HELPER}&topic=Rules&dryRun=true`,
      `/api/guilds/${GUILD}/notes?roleId=${HELPER}&topic=Rules&confirm=true`,
    ]);
  });

  it('re-reads the page when the answer to a save cannot be read, so a retry cannot duplicate', async () => {
    serve((_url, init) => (init?.method === 'PATCH' ? answer({ unexpected: true }) : undefined));
    renderWithProviders(<NotePage guildId={GUILD} notes={NOTES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sửa ghi chú Zeta' }));
    const dialog = await screen.findByRole('dialog');
    const content = within(dialog).getByLabelText('Nội dung');
    await userEvent.clear(content);
    await userEvent.type(content, 'changed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu ghi chú' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(writes()).toHaveLength(1);
  });
});
