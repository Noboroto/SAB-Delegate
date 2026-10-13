import { describe, expect, it } from 'vitest';
import {
  GuildSettingsDryRunSchema,
  GuildSettingsPatchSchema,
  GuildSettingsSchema,
  WORD_MAX_WORDS_MAX,
  WORD_MAX_WORDS_MIN,
} from './guild-config.js';

const CHANNEL = '123456789012345678';

describe('GuildSettingsPatchSchema', () => {
  it('leaves absent fields absent, so the wordMaxWords default never overwrites stored data', () => {
    expect(GuildSettingsPatchSchema.parse({})).toEqual({});
    expect(GuildSettingsPatchSchema.parse({ logChannelId: CHANNEL })).toEqual({
      logChannelId: CHANNEL,
    });
  });

  it('strips fields it does not know instead of rejecting or keeping them', () => {
    const parsed = GuildSettingsPatchSchema.parse({
      introChannelId: CHANNEL,
      guildId: 'internal-key',
      id: 'row-id',
      isAdmin: true,
    });
    expect(parsed).toEqual({ introChannelId: CHANNEL });
  });

  it('accepts null to clear a channel and a locale from the catalog', () => {
    expect(GuildSettingsPatchSchema.parse({ birthdayChannelId: null, locale: 'en' })).toEqual({
      birthdayChannelId: null,
      locale: 'en',
    });
  });

  it('rejects an id that is not a snowflake, such as a mention', () => {
    for (const bad of ['<#123456789012345678>', '123', '', 42]) {
      expect(GuildSettingsPatchSchema.safeParse({ wordChannelId: bad }).success, String(bad)).toBe(
        false,
      );
    }
  });

  it('bounds wordMaxWords from the 200 floor to the Int column', () => {
    const accepts = (value: unknown) =>
      GuildSettingsPatchSchema.safeParse({ wordMaxWords: value }).success;
    expect(accepts(WORD_MAX_WORDS_MIN - 1)).toBe(false);
    expect(accepts(WORD_MAX_WORDS_MIN)).toBe(true);
    expect(accepts(WORD_MAX_WORDS_MAX)).toBe(true);
    expect(accepts(WORD_MAX_WORDS_MAX + 1)).toBe(false);
    expect(accepts(1500.5)).toBe(false);
    expect(accepts('1500')).toBe(false);
  });

  it('rejects a language the catalog does not cover', () => {
    expect(GuildSettingsPatchSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});

describe('GuildSettingsSchema', () => {
  const settings = {
    introChannelId: null,
    logChannelId: CHANNEL,
    birthdayChannelId: null,
    activityCategoryId: null,
    wordChannelId: null,
    locale: 'vi',
  };

  it('fills wordMaxWords with the stored default when the row predates the column value', () => {
    expect(GuildSettingsSchema.parse(settings).wordMaxWords).toBe(1500);
  });

  it('drops columns that are not settings, such as the internal keys', () => {
    const parsed = GuildSettingsSchema.parse({
      ...settings,
      id: 'internal',
      guildId: 'internal',
      updatedAt: new Date(),
    });
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'activityCategoryId',
        'birthdayChannelId',
        'introChannelId',
        'locale',
        'logChannelId',
        'wordChannelId',
        'wordMaxWords',
      ].sort(),
    );
  });
});

describe('GuildSettingsDryRunSchema', () => {
  it('needs both the current and the planned settings', () => {
    const settings = GuildSettingsSchema.parse({
      introChannelId: null,
      logChannelId: null,
      birthdayChannelId: null,
      activityCategoryId: null,
      wordChannelId: null,
      locale: 'vi',
    });
    expect(GuildSettingsDryRunSchema.safeParse({ before: settings, after: settings }).success).toBe(
      true,
    );
    expect(GuildSettingsDryRunSchema.safeParse({ before: settings }).success).toBe(false);
  });
});
