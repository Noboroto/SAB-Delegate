import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedGuardProvider } from '@/components/forms/unsaved-guard';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { GUILD, pickOption, stubToolApi } from '@/lib/tools/test-support';

const nav = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.search,
  useRouter: () => nav,
  usePathname: () => `/servers/${'1'.repeat(18)}/tools/threads`,
}));

import { ThreadsTool } from './threads-tool';

beforeEach(() => {
  nav.refresh.mockReset();
  nav.replace.mockReset();
  nav.search = new URLSearchParams();
  stubToolApi();
});

describe('ThreadsTool', () => {
  it('opens the tab named in the address', () => {
    renderWithProviders(<ThreadsTool guildId={GUILD} initialTab="rename" />);
    expect(screen.getByRole('tab', { name: 'Đổi tên', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Tiền tố hiện tại')).toBeInTheDocument();
  });

  it('puts the chosen tab on the address', async () => {
    renderWithProviders(<ThreadsTool guildId={GUILD} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Xoá' }));

    expect(nav.replace).toHaveBeenCalledWith(`/servers/${GUILD}/tools/threads?tab=delete`, {
      scroll: false,
    });
  });

  it('follows the address when it changes, as the Back button does', () => {
    nav.search = new URLSearchParams('tab=delete');
    renderWithProviders(<ThreadsTool guildId={GUILD} initialTab="create" />);
    expect(screen.getByRole('tab', { name: 'Xoá', selected: true })).toBeInTheDocument();
  });

  it('asks before a tab with unsent text is left, and stays when the person says so', async () => {
    renderWithProviders(
      <UnsavedGuardProvider>
        <ThreadsTool guildId={GUILD} />
      </UnsavedGuardProvider>,
    );
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tin nhắn đầu tiên'), 'Draft');
    await userEvent.click(screen.getByRole('tab', { name: 'Xoá' }));

    expect(await screen.findByRole('button', { name: 'Ở lại' })).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(screen.getByRole('tab', { name: 'Mở thread', selected: true })).toBeInTheDocument();
  });
});
