import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { ActivityCommands } from './activity.commands.js';
import type { ActivityService } from './activity.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CATEGORY = '100000000000000009';
const RESULT = {
  categoryId: CATEGORY,
  roles: { event: '200000000000000001', multi: '200000000000000002', mc: '200000000000000003' },
  channels: {
    general: '300000000000000001',
    threadOnly: '300000000000000002',
    voice: '300000000000000003',
  },
};

function build(options: { category?: string | null; locale?: 'vi' | 'en' } = {}) {
  const activities = {
    resolveCategoryId: vi
      .fn()
      .mockImplementation((_guild: string, requested?: string) =>
        Promise.resolve(requested ?? options.category ?? null),
      ),
    createActivity: vi.fn().mockResolvedValue(RESULT),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(options.locale ?? 'en') };
  const commands = new ActivityCommands(
    activities as unknown as ActivityService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'en',
      user: { id: USER },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, activities, interaction };
}

const OPTIONS = { emoji: '🎉', name: ' Game Night ', shortName: 'GNT' };

describe('/create-activity', () => {
  it('defers, creates with the category it settled on, and links what was made', async () => {
    const { commands, activities, interaction } = build({ category: CATEGORY });
    const target = interaction();
    await commands.onCreate([target] as never, { ...OPTIONS, category: undefined });

    expect(target.deferReply).toHaveBeenCalledWith();
    expect(activities.createActivity).toHaveBeenCalledWith(
      GUILD,
      { emoji: '🎉', name: ' Game Night ', shortName: 'GNT', categoryId: CATEGORY },
      { source: 'DISCORD', userId: USER },
    );
    const content = (target.editReply.mock.calls[0]?.[0] as { content: string }).content;
    expect(content).toContain('"Game Night"');
    for (const id of Object.values(RESULT.roles)) expect(content).toContain(`<@&${id}>`);
    for (const id of Object.values(RESULT.channels)) expect(content).toContain(`<#${id}>`);
  });

  it('prefers the category option over the default', async () => {
    const { commands, activities, interaction } = build({ category: '100000000000000008' });
    await commands.onCreate([interaction()] as never, { ...OPTIONS, category: { id: CATEGORY } });
    expect(activities.resolveCategoryId).toHaveBeenCalledWith(GUILD, CATEGORY);
    expect(activities.createActivity.mock.calls[0]?.[1]).toMatchObject({ categoryId: CATEGORY });
  });

  it('refuses privately and creates nothing when there is no category', async () => {
    const { commands, activities, interaction } = build({ category: null });
    const target = interaction();
    await commands.onCreate([target] as never, { ...OPTIONS, category: null });

    expect(target.deferReply).not.toHaveBeenCalled();
    expect(activities.createActivity).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledWith({
      content: MESSAGES.en.activity.noCategory,
      flags: MessageFlags.Ephemeral,
    });
  });

  it.each([
    [{ emoji: '  ' }, 'The emoji must not be empty.'],
    [{ name: ' \t ' }, 'The activity name must not be empty.'],
    [
      { shortName: ' ab' },
      'The short name must be exactly 3 characters, not counting spaces at the ends.',
    ],
    [
      { shortName: '   ' },
      'The short name must be exactly 3 characters, not counting spaces at the ends.',
    ],
  ])('says what is wrong with %o instead of a generic failure', async (bad, expected) => {
    const { commands, activities, interaction } = build({ category: CATEGORY });
    const target = interaction();
    await commands.onCreate([target] as never, { ...OPTIONS, ...bad, category: undefined });

    expect(target.reply).toHaveBeenCalledWith({ content: expected, flags: MessageFlags.Ephemeral });
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(activities.createActivity).not.toHaveBeenCalled();
  });

  it('accepts a short name whose trimmed text is the right length', async () => {
    const { commands, activities, interaction } = build({ category: CATEGORY });
    await commands.onCreate([interaction()] as never, { ...OPTIONS, shortName: 'GNT' });
    expect(activities.createActivity).toHaveBeenCalled();
  });

  it('answers in the language of the server', async () => {
    const { commands, interaction } = build({ category: null, locale: 'vi' });
    const target = interaction();
    await commands.onCreate([target] as never, { ...OPTIONS });
    expect((target.reply.mock.calls[0]?.[0] as { content: string }).content).toBe(
      MESSAGES.vi.activity.noCategory,
    );
  });

  it('has no server to work in when run in a direct message', async () => {
    const { commands, activities, interaction } = build({ category: CATEGORY });
    await expect(commands.onCreate([interaction(null)] as never, { ...OPTIONS })).rejects.toEqual(
      expect.objectContaining({ name: 'ServiceError', code: ErrorCode.GUILD_NOT_FOUND }),
    );
    expect(activities.createActivity).not.toHaveBeenCalled();
  });
});
