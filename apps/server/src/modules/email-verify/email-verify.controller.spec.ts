import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  asUser,
  createRestApp,
  expectGuarded,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { EmailListService } from './email-list.service.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';
import { EmailVerifyController, attachmentDisposition } from './email-verify.controller.js';
import { EmailVerifyService } from './email-verify.service.js';
import { MailerService } from './mailer.service.js';
import { SmtpConfigService } from './smtp-config.service.js';

const OTHER_GUILD = '100000000000000777';
const LIST = '0190a000-0000-7000-8000-0000000000b1';
const USER = '100000000000000555';
const base = `/api/guilds/${GUILD}/email-verify`;

const config = { get: vi.fn(), patch: vi.fn(), rules: vi.fn() };
const lists = { delete: vi.fn(), addEntries: vi.fn() };
const members = { members: vi.fn(), exportXlsx: vi.fn(), revoke: vi.fn(), manualVerify: vi.fn() };
const flow = { status: vi.fn(), testMail: vi.fn() };
const discord = { postButton: vi.fn() };
const smtp = { adminGuildId: GUILD, view: vi.fn(), save: vi.fn() };
const mailer = { testStored: vi.fn() };

let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [EmailVerifyController],
    [
      { provide: EmailVerifyConfigService, useValue: config },
      { provide: EmailListService, useValue: lists },
      { provide: EmailVerifyMembersService, useValue: members },
      { provide: EmailVerifyService, useValue: flow },
      { provide: EmailVerifyDiscordService, useValue: discord },
      { provide: SmtpConfigService, useValue: smtp },
      { provide: MailerService, useValue: mailer },
    ],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.resetAllMocks();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  test.app.inject({ method, url, payload, headers: asUser() });

describe('email-verify REST', () => {
  it('is closed to strangers and to people who cannot manage the server', async () => {
    await expectGuarded(test, { method: 'GET', url: `${base}/config` });
    await expectGuarded(test, { method: 'GET', url: `${base}/members/export` });
  });

  it('answers the config through its schema', async () => {
    config.get.mockResolvedValue({
      enabled: true,
      defaultRoleIds: [],
      unverifiedRoleId: null,
      logChannelId: null,
      verifyMessage: null,
      autoVerifyOnJoin: false,
      autoUnverifiedOnJoin: false,
      secretColumn: 'x',
    });
    const response = await call('GET', `${base}/config`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('secretColumn');
  });

  it('passes only the fields a patch names', async () => {
    config.patch.mockResolvedValue({
      enabled: false,
      defaultRoleIds: [],
      unverifiedRoleId: null,
      logChannelId: null,
      verifyMessage: null,
      autoVerifyOnJoin: false,
      autoUnverifiedOnJoin: false,
    });
    const response = await call('PATCH', `${base}/config`, { enabled: false, extra: 1 });
    expect(response.statusCode).toBe(200);
    expect(config.patch).toHaveBeenCalledWith(GUILD, { enabled: false }, expect.anything());
  });

  it('serves the Excel export as an attachment that is never cached', async () => {
    members.exportXlsx.mockResolvedValue({
      buffer: Buffer.from('xlsx-bytes'),
      count: 1,
      unresolved: 2,
      fileName: 'thành-viên-2026-10-21.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const response = await call('GET', `${base}/members/export`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-export-unresolved']).toBe('2');
    expect(response.body).toBe('xlsx-bytes');
  });

  it('answers deletes with 204 and refuses a malformed id', async () => {
    expect((await call('DELETE', `${base}/lists/${LIST}`)).statusCode).toBe(204);
    expect(lists.delete).toHaveBeenCalledWith(GUILD, LIST, expect.anything());
    expect((await call('DELETE', `${base}/lists/not-a-uuid`)).statusCode).toBe(400);
    expect((await call('DELETE', `${base}/members/${USER}`)).statusCode).toBe(204);
    expect((await call('DELETE', `${base}/members/abc`)).statusCode).toBe(400);
  });

  it('never puts an address in the manual-verify response beyond the row schema', async () => {
    members.manualVerify.mockResolvedValue({
      member: {
        userId: USER,
        domain: 'example.test',
        method: 'MANUAL',
        email: 'a@example.test',
        displayName: null,
        verifiedAt: '2026-10-21T00:00:00.000Z',
        encrypted: 'secret',
      },
      grant: null,
    });
    const response = await call('POST', `${base}/members`, {
      userId: USER,
      email: 'a@example.test',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('encrypted');
  });
});

describe('email-verify REST: SMTP', () => {
  const smtpView = {
    adminServer: true,
    available: true,
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    username: 'u',
    fromAddress: 'a@example.test',
    fromName: null,
    enabled: true,
    passwordSet: true,
    passwordEnc: 'leak',
  };

  it('never returns the password or its ciphertext', async () => {
    smtp.view.mockResolvedValue(smtpView);
    const response = await call('GET', `${base}/smtp`);
    expect(response.json()).toMatchObject({ passwordSet: true });
    expect(JSON.stringify(response.json())).not.toContain('leak');
  });

  it('tests the stored account and ignores whatever the client sends', async () => {
    mailer.testStored.mockResolvedValue({ ok: false, reason: 'auth' });
    const response = await call('POST', `${base}/smtp/test`, { host: 'evil.example.test' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, reason: 'auth' });
    expect(mailer.testStored).toHaveBeenCalledWith(expect.objectContaining({ source: 'HTTP' }));
    const refused = await call('POST', `/api/guilds/${OTHER_GUILD}/email-verify/smtp/test`);
    expect(refused.statusCode).toBe(404);
  });
});

describe('attachmentDisposition', () => {
  it('gives an ASCII fallback and the encoded real name', () => {
    expect(attachmentDisposition('thành viên.xlsx')).toBe(
      `attachment; filename="th_nh_vi_n.xlsx"; filename*=UTF-8''${encodeURIComponent('thành viên.xlsx')}`,
    );
  });
});
