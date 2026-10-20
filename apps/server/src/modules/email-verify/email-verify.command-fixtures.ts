import { vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';

export const GUILD = '100000000000000001';
export const USER = '100000000000000002';
export const ROLE_A = '300000000000000001';
export const ROLE_B = '300000000000000002';

/** A server-language lookup that always answers English. */
export const english = () =>
  ({ resolve: vi.fn().mockResolvedValue('en') }) as unknown as GuildLocaleService;

/**
 * A slash command interaction as the handlers use it. `click` is what the
 * person presses when a command asks to confirm (`null`: nobody answers).
 */
export function slash(options: { guildId?: string | null; click?: 'confirm' | 'cancel' } = {}) {
  const click = {
    customId: options.click ?? 'confirm',
    user: { id: USER },
    update: vi.fn().mockResolvedValue(undefined),
  };
  const prompt = { awaitMessageComponent: vi.fn().mockResolvedValue(click) };
  const target = {
    guildId: options.guildId === undefined ? GUILD : options.guildId,
    locale: 'en',
    user: { id: USER },
    replied: false,
    deferred: false,
    showModal: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(() => {
      target.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn().mockResolvedValue(prompt),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  return { target, click, prompt };
}

/** The texts the interaction was answered with, in order. */
export function answers(target: { editReply: { mock: { calls: unknown[][] } } }): string[] {
  return target.editReply.mock.calls.map((call) => (call[0] as { content: string }).content);
}
