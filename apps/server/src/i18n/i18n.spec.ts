import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { COMMAND_DESCRIPTION_MAX_LENGTH, ErrorCodeSchema, MESSAGES } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { GuildLocaleService } from './guild-locale.service.js';
import { localizations } from './localizations.js';
import { translatorFor } from './translator.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('translatorFor', () => {
  it('answers in the requested language from the shared catalog', () => {
    expect(translatorFor('vi')('errors.GUILD_NOT_FOUND')).toBe(MESSAGES.vi.errors.GUILD_NOT_FOUND);
    expect(translatorFor('en')('errors.GUILD_NOT_FOUND')).toBe(MESSAGES.en.errors.GUILD_NOT_FOUND);
    expect(MESSAGES.vi.errors.GUILD_NOT_FOUND).not.toBe(MESSAGES.en.errors.GUILD_NOT_FOUND);
  });

  it('names the missing channel permission through the ICU select', () => {
    const en = translatorFor('en');
    const vi = translatorFor('vi');
    const text = (t: typeof en, permission: string) =>
      t('errors.DISCORD_MISSING_PERMISSIONS', { permission });
    expect(text(en, 'view')).toContain('view this channel');
    expect(text(en, 'send')).toContain('send messages');
    expect(text(vi, 'view')).toContain('xem kênh');
    expect(text(vi, 'send')).toContain('gửi tin nhắn');
    for (const t of [en, vi]) {
      expect(text(t, 'view')).not.toBe(text(t, 'send'));
      expect(text(t, 'something-else')).not.toContain('{');
    }
  });

  it('maps regional tags onto their language and any other language to English', () => {
    expect(translatorFor('en-US')('common.commandFailed')).toBe(MESSAGES.en.common.commandFailed);
    expect(translatorFor('vi-VN')('common.commandFailed')).toBe(MESSAGES.vi.common.commandFailed);
    expect(translatorFor('fr')('common.commandFailed')).toBe(MESSAGES.en.common.commandFailed);
    expect(translatorFor('')('common.commandFailed')).toBe(MESSAGES.en.common.commandFailed);
  });

  it('formats ICU plurals by each language rules', () => {
    const en = translatorFor('en');
    expect(en('common.memberCount', { count: 0 })).toBe('0 members');
    expect(en('common.memberCount', { count: 1 })).toBe('1 member');
    expect(en('common.memberCount', { count: 2 })).toBe('2 members');
    const vi = translatorFor('vi');
    expect(vi('common.memberCount', { count: 1 })).toBe('1 thành viên');
    expect(vi('common.messageCount', { count: 3 })).toBe('3 tin nhắn');
  });

  it('formats large counts with the plural number placeholder', () => {
    expect(translatorFor('en')('common.messageCount', { count: 1500 })).toBe('1,500 messages');
  });

  it('reuses one translator per language', () => {
    expect(translatorFor('vi')).toBe(translatorFor('vi-VN'));
    expect(translatorFor('en')).toBe(translatorFor('fr'));
    expect(translatorFor('vi')).not.toBe(translatorFor('en'));
  });

  it('has a message for every ErrorCode in both languages', () => {
    for (const locale of ['vi', 'en']) {
      const t = translatorFor(locale);
      for (const code of ErrorCodeSchema.options) {
        expect(t.has(`errors.${code}`), `${locale} ${code}`).toBe(true);
        expect(t(`errors.${code}`).length).toBeGreaterThan(0);
      }
    }
  });

  it('does not throw when a placeholder has no value, and logs without failing the reply', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // The compile-time key check cannot see a missing argument at a dynamic call site.
    const loose = translatorFor('en') as unknown as (key: string) => string;
    expect(() => loose('common.memberCount')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('localizations', () => {
  it('returns the Vietnamese and both English texts of the same catalog key', () => {
    expect(localizations('commands.birthday.description')).toEqual({
      vi: MESSAGES.vi.commands.birthday.description,
      'en-US': MESSAGES.en.commands.birthday.description,
      'en-GB': MESSAGES.en.commands.birthday.description,
    });
  });

  it('serves every command in the catalog within the description limit', () => {
    const names = Object.keys(MESSAGES.en.commands) as Array<keyof typeof MESSAGES.en.commands>;
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const result = localizations(`commands.${name}.description`);
      for (const text of Object.values(result)) {
        expect(text.length, name).toBeGreaterThan(0);
        expect(text.length, name).toBeLessThanOrEqual(COMMAND_DESCRIPTION_MAX_LENGTH);
      }
    }
  });
});

describe('GuildLocaleService', () => {
  function build(findUnique: ReturnType<typeof vi.fn>) {
    const prisma = { guild: { findUnique } } as unknown as PrismaService;
    return new GuildLocaleService(prisma);
  }
  const found = (locale: string) => vi.fn().mockResolvedValue({ locale });
  const missing = () => vi.fn().mockResolvedValue(null);

  it('prefers the stored guild language over what the interaction says', async () => {
    const findUnique = found('en');
    const service = build(findUnique);
    await expect(service.resolve('123', { locale: 'vi' })).resolves.toBe('en');
    expect(findUnique).toHaveBeenCalledWith({
      where: { discordId: '123' },
      select: { locale: true },
    });
  });

  it('falls back to the invoker client language for a guild with no row', async () => {
    await expect(build(missing()).resolve('123', { locale: 'en-US' })).resolves.toBe('en');
  });

  it('skips an unsupported client language and uses the guild preferred language', async () => {
    const service = build(missing());
    await expect(
      service.resolve('123', { locale: 'fr', guild: { preferredLocale: 'en-GB' } }),
    ).resolves.toBe('en');
    await expect(service.resolve('123', { locale: 'fr', guildLocale: 'en-GB' })).resolves.toBe(
      'en',
    );
  });

  it('defaults to Vietnamese when nothing is known', async () => {
    const service = build(missing());
    await expect(service.resolve('123')).resolves.toBe('vi');
    await expect(service.resolve('123', { locale: 'ja', guild: null })).resolves.toBe('vi');
  });

  it('ignores a stored value the catalog does not cover', async () => {
    await expect(build(found('xx')).resolve('123', { locale: 'en' })).resolves.toBe('en');
  });

  it('does not query without a guild, as in a direct message', async () => {
    const findUnique = found('en');
    const service = build(findUnique);
    await expect(service.resolve(null, { locale: 'vi' })).resolves.toBe('vi');
    await expect(service.resolve(undefined)).resolves.toBe('vi');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('still answers when the lookup fails, naming the error type and not its text', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = vi.fn().mockRejectedValue(new TypeError('connection string secret-value'));
    await expect(build(failing).resolve('123', { locale: 'en' })).resolves.toBe('en');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('secret-value');
  });

  it('is built by the container from the Prisma service', async () => {
    const prisma = { guild: { findUnique: found('en') } };
    const moduleRef = await Test.createTestingModule({
      providers: [GuildLocaleService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    await expect(moduleRef.get(GuildLocaleService).resolve('123')).resolves.toBe('en');
    await moduleRef.close();
  });
});
