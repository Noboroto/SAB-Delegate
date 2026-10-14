import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ThemeProvider, useTheme } from './ui/theme-provider';
import { ThemeSwitcher } from './theme-switcher';

function Probe() {
  const { mode, resolved } = useTheme();
  return <output data-testid="theme">{`${mode}/${resolved}`}</output>;
}

function renderSwitcher(
  initialMode: 'light' | 'dark' | 'system',
  initialResolved: 'light' | 'dark',
) {
  return renderWithProviders(
    <ThemeProvider initialMode={initialMode} initialResolved={initialResolved}>
      <ThemeSwitcher />
      <Probe />
    </ThemeProvider>,
  );
}

describe('ThemeSwitcher', () => {
  afterEach(() => {
    document.cookie = 'theme=; max-age=0; path=/';
    document.cookie = 'theme-mode=; max-age=0; path=/';
    document.documentElement.removeAttribute('data-theme');
  });

  it('labels each choice in the page language', () => {
    renderSwitcher('light', 'light');
    expect(screen.getByRole('radio', { name: 'Tối' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sáng' })).toBeChecked();
  });

  it('applies the choice to the page and remembers it for the server to render next time', async () => {
    renderSwitcher('light', 'light');
    await userEvent.click(screen.getByRole('img', { name: 'Tối' }));

    expect(screen.getByTestId('theme')).toHaveTextContent('dark/dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.cookie).toContain('theme-mode=dark');
    expect(document.cookie).toContain('theme=dark');
  });

  it('follows the system preference while set to system', () => {
    const listeners: Array<() => void> = [];
    let dark = false;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return dark;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;

    renderSwitcher('system', 'light');
    expect(screen.getByTestId('theme')).toHaveTextContent('system/light');

    dark = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(screen.getByTestId('theme')).toHaveTextContent('system/dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
