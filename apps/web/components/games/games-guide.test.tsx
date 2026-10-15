import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { GamesGuide } from './games-guide';

const TEXT = {
  vi: {
    title: 'Trò chơi',
    games: ['Nối từ', 'Đếm số', 'Vua Tiếng Việt', 'Wordle'],
    command: '/game set game:Wordle channel:#kênh',
  },
  en: {
    title: 'Games',
    games: ['Word chain', 'Counting', 'Vietnamese scramble', 'Wordle'],
    command: '/game set game:Wordle channel:#channel',
  },
} as const;

describe.each(SUPPORTED_LOCALES)('GamesGuide (%s)', (locale) => {
  it('shows one card per game with its rules and set-up commands as code', () => {
    const { container } = renderWithProviders(<GamesGuide />, locale);
    expect(screen.getByRole('heading', { level: 1, name: TEXT[locale].title })).toBeInTheDocument();
    for (const game of TEXT[locale].games) expect(screen.getByText(game)).toBeInTheDocument();
    const codes = [...container.querySelectorAll('code')].map((node) => node.textContent);
    expect(codes).toContain(TEXT[locale].command);
    // No backtick survives: every command became inline code.
    expect(container.textContent).not.toContain('`');
  });
});
