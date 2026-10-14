import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/servers',
}));
vi.mock('@/lib/auth/auth-client', () => ({ signOut: vi.fn() }));

import { ThemeProvider } from '../ui/theme-provider';
import { AppFrame } from './app-frame';

describe('AppFrame', () => {
  it('has exactly one main landmark, the target of the skip link, around the page', () => {
    const { container } = renderWithProviders(
      <ThemeProvider initialMode="light" initialResolved="light">
        <AppFrame>
          <p>page</p>
        </AppFrame>
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('main')).toContainElement(screen.getByText('page'));
  });
});
