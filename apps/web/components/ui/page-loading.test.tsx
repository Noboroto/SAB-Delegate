import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { PageLoading } from './page-loading';

describe('PageLoading', () => {
  it('is announced as a status in the page language', () => {
    renderWithProviders(<PageLoading />, 'en');
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
  });
});
