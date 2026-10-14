import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LangSwitcher } from './lang-switcher';

describe('LangSwitcher', () => {
  beforeEach(() => {
    refresh.mockClear();
    document.cookie = 'locale=; max-age=0; path=/';
  });

  it('shows the current language as selected', () => {
    renderWithProviders(<LangSwitcher />, 'en');
    expect(screen.getByRole('radio', { name: 'EN' })).toBeChecked();
  });

  it('stores the choice in the cookie the request config reads and re-renders the server components', async () => {
    renderWithProviders(<LangSwitcher />, 'vi');
    await userEvent.click(screen.getByText('EN'));

    expect(document.cookie).toContain('locale=en');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
