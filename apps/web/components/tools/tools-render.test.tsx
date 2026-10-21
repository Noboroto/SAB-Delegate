import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { expectNoBareKeys, GUILD, stubToolApi } from '@/lib/tools/test-support';

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

import { ActivityTool } from './activity/activity-tool';
import { AttendanceTool } from './attendance/attendance-tool';
import { InfoTool } from './info/info-tool';
import { MentionTool } from './mention/mention-tool';
import { PurgeTool } from './purge/purge-tool';
import { RoleAssignTool } from './role-assign/role-assign-tool';
import { ThreadsTool } from './threads/threads-tool';
import { ToolsIndex } from './tools-index';

// Written out per language on purpose: the expectation must not come from the
// catalog it checks.
const PAGES: [string, ComponentType<{ guildId: string }>, string, string][] = [
  ['tools index', ToolsIndex, 'Công cụ', 'Tools'],
  ['mention', MentionTool, 'Danh sách nhắc tên', 'Mention lists'],
  ['role-assign', RoleAssignTool, 'Gán vai trò', 'Assign roles'],
  ['threads', ThreadsTool, 'Thread', 'Threads'],
  ['purge', PurgeTool, 'Xoá tin nhắn', 'Delete messages'],
  ['activity', ActivityTool, 'Hoạt động mới', 'New activity'],
  ['attendance', AttendanceTool, 'Điểm danh kênh thoại', 'Voice attendance'],
  ['info', InfoTool, 'Tra cứu', 'Lookups'],
];

beforeEach(() => {
  stubToolApi();
});

describe.each(SUPPORTED_LOCALES)('tool pages (%s)', (locale) => {
  it.each(PAGES)('%s has its heading and no untranslated text', (_name, Page, vi, en) => {
    renderWithProviders(<Page guildId={GUILD} />, locale);
    expect(
      screen.getByRole('heading', { level: 1, name: locale === 'vi' ? vi : en }),
    ).toBeInTheDocument();
    expectNoBareKeys();
  });
});

describe('tools index', () => {
  it('links to all seven tools', () => {
    renderWithProviders(<ToolsIndex guildId={GUILD} />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(
      ['mention', 'role-assign', 'threads', 'purge', 'activity', 'attendance', 'info'].map(
        (tool) => `/servers/${GUILD}/tools/${tool}`,
      ),
    );
  });
});
