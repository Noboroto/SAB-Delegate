import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ServerList } from './server-list';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('ServerList', () => {
  it('prints each name once and marks its icon decorative, so it is not read twice', () => {
    const { container } = renderWithProviders(
      <ServerList guilds={[{ id: '1'.repeat(18), name: 'Alpha', icon: 'abc123' }]} />,
    );
    expect(screen.getAllByText('Alpha')).toHaveLength(1);
    const icon = container.querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('alt')).toBe('');
  });
});
