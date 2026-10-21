import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD, stubApi } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: async (path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
    parser.parse(await api.fetch(path)),
}));
vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);
vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => `/servers/${GUILD}/modules/email-verify`,
}));

import EmailVerifyPage, { generateMetadata } from './page';

const params = Promise.resolve({ guildId: GUILD });
const ROLE = '5'.repeat(18);
const BASE = `/api/guilds/${GUILD}/email-verify`;

const SMTP = (adminServer: boolean) => ({
  adminServer,
  available: true,
  passwordSet: true,
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  username: 'bot',
  fromAddress: 'bot@example.com',
  fromName: null,
  enabled: true,
});
const STATUS = {
  enabled: true,
  smtpReady: true,
  verified: 12,
  pending: 3,
  lists: 2,
  rules: 1,
  sentToday: 5,
  dailyCap: 200,
};
const CONFIG = {
  enabled: true,
  defaultRoleIds: [ROLE],
  unverifiedRoleId: null,
  logChannelId: null,
  verifyMessage: null,
  autoVerifyOnJoin: false,
  autoUnverifiedOnJoin: false,
};
const RULES = {
  rules: [
    {
      condition: { combinator: 'or', rules: [{ field: 'domain', operator: '=', value: '*.edu' }] },
      roleIds: [ROLE],
      text: 'domain:*.edu',
      missingLists: [],
    },
  ],
};
const LISTS = [
  {
    id: '0198f2c4-7b1a-7c3e-9d11-2b8f5a6c4e01',
    name: 'k21',
    entryCount: 4,
    createdAt: '2026-10-20T05:00:00.000Z',
  },
];
const MEMBERS = {
  items: [
    {
      userId: '7'.repeat(18),
      email: 'an@hcmus.edu.vn',
      displayName: 'An',
      domain: 'hcmus.edu.vn',
      method: 'CODE',
      verifiedAt: '2026-10-20T05:00:00.000Z',
    },
  ],
  pagination: { page: 1, pageSize: 10, total: 1 },
};

let admin = true;

function paths(): string[] {
  return api.fetch.mock.calls.map(([path]) => path as string);
}

beforeEach(() => {
  admin = true;
  api.fetch.mockReset();
  redirect.mockClear();
  api.fetch.mockImplementation((path: string) => {
    if (path === `${BASE}/smtp`) return Promise.resolve(SMTP(admin));
    if (path === `${BASE}/status`) return Promise.resolve(STATUS);
    if (path === `${BASE}/config`) return Promise.resolve(CONFIG);
    if (path === `${BASE}/rules`) return Promise.resolve(RULES);
    if (path === `${BASE}/blocklist`) return Promise.resolve({ patterns: ['*@mailinator.com'] });
    if (path === `${BASE}/lists`) return Promise.resolve(LISTS);
    if (path.startsWith(`${BASE}/members?`)) return Promise.resolve(MEMBERS);
    return Promise.reject(new Error(`unexpected read ${path}`));
  });
  stubApi((path) =>
    path.endsWith('/discord/roles') ? [{ id: ROLE, name: 'Student', managed: false }] : [],
  );
});

describe('email-verify route', () => {
  it('titles the tab', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Xác thực email' });
  });

  it('opens the overview and reads only the status and the mail server view', async () => {
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'nope' }) }),
    );
    expect(paths().sort()).toEqual([`${BASE}/smtp`, `${BASE}/status`]);
    expect(screen.getByRole('heading', { level: 1, name: 'Xác thực email' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tổng quan', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Máy chủ thư' })).toBeInTheDocument();
  });

  it('hides the mail server tab outside the admin server and opens the overview instead', async () => {
    admin = false;
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'smtp' }) }),
    );
    expect(screen.queryByRole('tab', { name: 'Máy chủ thư' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tổng quan', selected: true })).toBeInTheDocument();
  });

  it('shows six tabs, the blocklist and button having moved into rules and settings', async () => {
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'nope' }) }),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('tab', { name: 'Danh sách chặn' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Nút xác thực' })).toBeNull();
  });

  it('opens the rules tab, with the blocklist card, for the retired blocklist link', async () => {
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'blocklist' }) }),
    );
    expect(
      screen.getByRole('tab', { name: 'Quy tắc truy cập', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lưu danh sách chặn')).toBeInTheDocument();
  });

  it('opens the settings tab, with the verify button card, for the retired button link', async () => {
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'button' }) }),
    );
    expect(screen.getByRole('tab', { name: 'Cài đặt', selected: true })).toBeInTheDocument();
    expect(paths()).toContain(`${BASE}/config`);
    expect(screen.getByText('Nút xác thực')).toBeInTheDocument();
  });

  it('reads the rules, lists, blocklist and config the rule editor needs', async () => {
    renderWithProviders(
      await EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'rules' }) }),
    );
    expect(paths().sort()).toEqual(
      [
        `${BASE}/blocklist`,
        `${BASE}/config`,
        `${BASE}/lists`,
        `${BASE}/rules`,
        `${BASE}/smtp`,
      ].sort(),
    );
    expect(
      screen.getByRole('tab', { name: 'Quy tắc truy cập', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('*.edu')).toBeInTheDocument();
  });

  it('reads the page of members the URL names for the server to filter', async () => {
    renderWithProviders(
      await EmailVerifyPage({
        params,
        searchParams: Promise.resolve({
          tab: 'members',
          page: '1',
          sort: 'domain',
          order: 'asc',
          q: 'edu',
        }),
      }),
    );
    expect(paths()).toContain(`${BASE}/members?page=1&pageSize=10&order=asc&sort=domain&q=edu`);
    expect(screen.getByText('an@hcmus.edu.vn')).toBeInTheDocument();
  });

  it('sends a link past the end of the members to the last page that exists', async () => {
    api.fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith(`${BASE}/members?`)
          ? { items: [], pagination: { page: 5, pageSize: 10, total: 15 } }
          : SMTP(true),
      ),
    );
    await expect(
      EmailVerifyPage({ params, searchParams: Promise.resolve({ tab: 'members', page: '5' }) }),
    ).rejects.toThrow('redirect:');
    expect(redirect).toHaveBeenCalledWith(
      `/servers/${GUILD}/modules/email-verify?tab=members&page=2&pageSize=10&order=desc&sort=verifiedAt`,
    );
  });
});
