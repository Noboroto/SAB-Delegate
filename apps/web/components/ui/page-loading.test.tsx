import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { PageLoading } from './page-loading';

describe('PageLoading', () => {
  it('is announced as a status in the page language', () => {
    renderWithProviders(<PageLoading />, 'en');
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
  });

  it.each(['form', 'table', 'cards'] as const)(
    'draws a %s skeleton instead of the spinner',
    (variant) => {
      const { container } = renderWithProviders(<PageLoading variant={variant} />, 'en');
      expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
      expect(container.querySelector('.ant-skeleton')).not.toBeNull();
      expect(container.querySelector('.ant-spin')).toBeNull();
    },
  );
});
