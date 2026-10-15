import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ModulesIndex } from './modules-index';

const GUILD = '1'.repeat(18);

const TEXT = {
  vi: {
    title: 'Mô-đun',
    names: ['Sinh nhật', 'Ghi chú', 'Nối từ', 'Trò chơi', 'Hẹn giờ', 'Tin nhắn'],
  },
  en: {
    title: 'Modules',
    names: ['Birthdays', 'Notes', 'Word game', 'Games', 'Schedule', 'Messaging'],
  },
} as const;

describe.each(SUPPORTED_LOCALES)('ModulesIndex (%s)', (locale) => {
  it('titles the page and links the six module pages without switches', () => {
    const { container } = renderWithProviders(<ModulesIndex guildId={GUILD} />, locale);
    expect(screen.getByRole('heading', { level: 1, name: TEXT[locale].title })).toBeInTheDocument();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      ['birthday', 'note', 'word-game', 'games', 'schedule', 'messaging'].map(
        (slug) => `/servers/${GUILD}/modules/${slug}`,
      ),
    );
    for (const name of TEXT[locale].names) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
