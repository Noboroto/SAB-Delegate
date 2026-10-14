import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeyView } from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
const mintApiKey = vi.hoisted(() => vi.fn());
const revokeApiKey = vi.hoisted(() => vi.fn());
const signInWithDiscord = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-keys/api-keys-api', () => ({ mintApiKey, revokeApiKey }));
vi.mock('@/lib/auth/auth-client', () => ({ signInWithDiscord }));

import { ApiKeysPage } from './api-keys-page';

const DAY = 86_400_000;
// Built at run time so no key-shaped literal sits in the source for scanners.
const SECRET = `sab_${'A'.repeat(43)}`;

function key(overrides: Partial<ApiKeyView>): ApiKeyView {
  return {
    id: '0198f6a0-0000-7000-8000-000000000001',
    name: 'Laptop',
    prefix: 'sab_abcd',
    mode: 'READ',
    createdAt: new Date(Date.now() - 2 * DAY),
    expiresAt: new Date(Date.now() + 30 * DAY),
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    ...overrides,
  };
}

const MINTED = {
  ...key({ id: '0198f6a0-0000-7000-8000-000000000009', name: 'New' }),
  plaintext: SECRET,
};

beforeEach(() => {
  refresh.mockReset();
  mintApiKey.mockReset();
  revokeApiKey.mockReset();
  signInWithDiscord.mockReset();
});

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    create: 'Tạo khoá',
    active: 'Đang dùng được',
    revoked: 'Đã thu hồi',
    expired: 'Đã hết hạn',
    never: 'Chưa dùng',
    connect: 'Cách kết nối',
  },
  en: {
    create: 'Create key',
    active: 'Active',
    revoked: 'Revoked',
    expired: 'Expired',
    never: 'Never used',
    connect: 'How to connect',
  },
} as const;

describe.each(SUPPORTED_LOCALES)('ApiKeysPage (%s)', (locale) => {
  const text = TEXT[locale];
  // The button carries a plus icon, whose label comes first in the accessible name.
  const createName = new RegExp(`${text.create}$`);

  it('lists keys with status, last use and the connection help', () => {
    renderWithProviders(
      <ApiKeysPage
        keys={[
          key({
            name: 'Laptop',
            lastUsedAt: new Date(Date.now() - DAY),
            lastUsedIp: '203.0.113.7',
          }),
          key({
            id: '0198f6a0-0000-7000-8000-000000000002',
            name: 'Old',
            expiresAt: new Date(Date.now() - DAY),
          }),
          key({ id: '0198f6a0-0000-7000-8000-000000000003', name: 'Gone', revokedAt: new Date() }),
        ]}
      />,
      locale,
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(text.active)).toBeInTheDocument();
    expect(screen.getByText(text.expired)).toBeInTheDocument();
    expect(screen.getByText(text.revoked)).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getAllByText(text.never).length).toBeGreaterThan(0);
    expect(screen.getByText(text.connect)).toBeInTheDocument();
    expect(screen.getByText(/\/mcp$/)).toBeInTheDocument();
    expect(document.body.textContent).toContain('${SAB_MCP_KEY}');
    expect(document.body.textContent).not.toMatch(/web-api-keys\./);
  });

  it('creates a key, shows the secret once and forgets it on close', async () => {
    mintApiKey.mockResolvedValue(MINTED);
    renderWithProviders(<ApiKeysPage keys={[]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: createName }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), '  CI box ');
    await userEvent.click(within(dialog).getByRole('button', { name: createName }));

    await waitFor(() => expect(mintApiKey).toHaveBeenCalledOnce());
    expect(mintApiKey).toHaveBeenCalledWith({ name: 'CI box', mode: 'READ', expiresInDays: 90 });
    const secretInput = await screen.findByDisplayValue(SECRET);
    expect(secretInput).toHaveAttribute('readonly');
    expect(refresh).toHaveBeenCalledOnce();

    // The create dialog may still be fading out, so take the dialog that holds the secret.
    const secretDialog = secretInput.closest<HTMLElement>('[role="dialog"]');
    if (secretDialog === null) throw new Error('the secret is not inside a dialog');
    const done = within(secretDialog).getByRole('button', {
      name: locale === 'en' ? 'I have saved the key' : 'Tôi đã lưu khoá',
    });
    await userEvent.click(done);
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('sends one request when the form is submitted twice', async () => {
    let finish: (value: typeof MINTED) => void = () => undefined;
    mintApiKey.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithProviders(<ApiKeysPage keys={[]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: createName }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Twice');
    const submit = within(dialog).getByRole('button', { name: createName });
    await userEvent.dblClick(submit);
    expect(mintApiKey).toHaveBeenCalledOnce();
    finish(MINTED);
    await screen.findByDisplayValue(SECRET);
  });

  it('does not send a nameless key', async () => {
    renderWithProviders(<ApiKeysPage keys={[]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: createName }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: createName }));
    expect(
      await within(dialog).findByText(
        locale === 'en' ? 'Give the key a name.' : 'Hãy đặt tên cho khoá.',
      ),
    ).toBeInTheDocument();
    expect(mintApiKey).not.toHaveBeenCalled();
  });

  it('offers a new sign-in when a write key needs a recent login', async () => {
    mintApiKey.mockRejectedValue(new ApiRequestError(403, 'AUTH_REAUTH_REQUIRED'));
    signInWithDiscord.mockResolvedValue(undefined);
    renderWithProviders(<ApiKeysPage keys={[]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: createName }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Writer');
    await userEvent.click(
      within(dialog).getByRole('radio', {
        name: locale === 'en' ? 'Read and change' : 'Đọc và thay đổi',
      }),
    );
    expect(
      within(dialog).getByText(locale === 'en' ? /lasts at most 30 days/i : /sống tối đa 30 ngày/i),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: createName }));

    expect(mintApiKey).toHaveBeenCalledWith({ name: 'Writer', mode: 'WRITE', expiresInDays: 30 });
    const again = await within(dialog).findByRole('button', {
      name: locale === 'en' ? 'Sign in again' : 'Đăng nhập lại',
    });
    await userEvent.click(again);
    expect(signInWithDiscord).toHaveBeenCalledWith('/account/api-keys');
  });

  it('shows a translated message for a server refusal, not its text', async () => {
    mintApiKey.mockRejectedValue(new ApiRequestError(409, 'API_KEY_LIMIT_REACHED'));
    renderWithProviders(<ApiKeysPage keys={[]} />, locale);
    await userEvent.click(screen.getByRole('button', { name: createName }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Sixth');
    await userEvent.click(within(dialog).getByRole('button', { name: createName }));
    expect(
      await within(dialog).findByText(
        locale === 'en' ? /maximum number of active API keys/ : /số khoá API/i,
      ),
    ).toBeInTheDocument();
  });

  it('revokes only after the confirmation, then refreshes', async () => {
    revokeApiKey.mockResolvedValue(key({ revokedAt: new Date() }));
    renderWithProviders(<ApiKeysPage keys={[key({ name: 'Laptop' })]} />, locale);
    await userEvent.click(
      screen.getByRole('button', {
        name: locale === 'en' ? 'Revoke key Laptop' : 'Thu hồi khoá Laptop',
      }),
    );
    expect(revokeApiKey).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        locale === 'en' ? /Scheduled messages this key created/ : /lịch hẹn giờ do khoá này tạo/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: locale === 'en' ? 'Revoke' : 'Thu hồi' }),
    );
    await waitFor(() =>
      expect(revokeApiKey).toHaveBeenCalledWith('0198f6a0-0000-7000-8000-000000000001'),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('stops offering new keys at the limit', () => {
    const keys = Array.from({ length: 5 }, (_, index) =>
      key({ id: `0198f6a0-0000-7000-8000-00000000010${index}`, name: `K${index}` }),
    );
    renderWithProviders(<ApiKeysPage keys={keys} />, locale);
    expect(screen.getByRole('button', { name: createName })).toBeDisabled();
  });
});
