import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { stubToolApi } from '@/lib/tools/test-support';

vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/servers/1/tools/threads',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ActivityToolPage, { generateMetadata as activityMetadata } from './activity/page';
import AttendanceToolPage, { generateMetadata as attendanceMetadata } from './attendance/page';
import InfoToolPage, { generateMetadata as infoMetadata } from './info/page';
import MentionToolPage, { generateMetadata as mentionMetadata } from './mention/page';
import ToolsPage, { generateMetadata as toolsMetadata } from './page';
import PurgeToolPage, { generateMetadata as purgeMetadata } from './purge/page';
import RoleAssignToolPage, { generateMetadata as roleAssignMetadata } from './role-assign/page';
import ThreadsToolPage, { generateMetadata as threadsMetadata } from './threads/page';

const GUILD = '1'.repeat(18);
const props = {
  params: Promise.resolve({ guildId: GUILD }),
  searchParams: Promise.resolve({}),
};

const PAGES = [
  ['tools index', ToolsPage, toolsMetadata, 'Công cụ'],
  ['mention', MentionToolPage, mentionMetadata, 'Danh sách nhắc tên'],
  ['role-assign', RoleAssignToolPage, roleAssignMetadata, 'Gán vai trò'],
  ['threads', ThreadsToolPage, threadsMetadata, 'Thread'],
  ['purge', PurgeToolPage, purgeMetadata, 'Xoá tin nhắn'],
  ['activity', ActivityToolPage, activityMetadata, 'Hoạt động mới'],
  ['attendance', AttendanceToolPage, attendanceMetadata, 'Điểm danh kênh thoại'],
  ['info', InfoToolPage, infoMetadata, 'Tra cứu'],
] as const;

beforeEach(() => {
  stubToolApi();
});

describe.each(PAGES)('%s page', (_name, Page, metadata, title) => {
  it('is titled in the tab and renders the tool for the server in the address', async () => {
    expect(await metadata()).toEqual({ title });
    renderWithProviders(await Page(props));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });
});
