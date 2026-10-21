import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { CopyButton } from './copy-button';
import { IdList } from './id-list';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CopyButton', () => {
  it('puts the text on the clipboard and says so', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    renderWithProviders(<CopyButton text="abc" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép' }));

    expect(writeText).toHaveBeenCalledWith('abc');
    expect(await screen.findByText('Đã sao chép.')).toBeInTheDocument();
  });

  it('tells the person when the browser refuses', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    renderWithProviders(<CopyButton text="abc" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép' }));

    expect(
      await screen.findByText('Không sao chép được. Hãy chọn đoạn văn bản và sao chép thủ công.'),
    ).toBeInTheDocument();
  });
});

describe('IdList', () => {
  it('shows the ids as plain text, one per line, with a copy button', () => {
    renderWithProviders(<IdList title="Members" ids={['1'.repeat(18), '2'.repeat(18)]} />, 'en');
    expect(screen.getByText('Members (2)')).toBeInTheDocument();
    // One id per line in the page; the text matcher folds the line break to a space.
    expect(screen.getByText(`${'1'.repeat(18)} ${'2'.repeat(18)}`)).toBeInTheDocument();
    // Two lists on one page must not both offer a button called just "Copy".
    expect(screen.getByRole('button', { name: 'Copy Members' })).toBeInTheDocument();
  });

  it('says so when there are none', () => {
    renderWithProviders(<IdList title="Members" ids={[]} />, 'en');
    expect(screen.getByText('None.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });
});
