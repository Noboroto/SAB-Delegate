import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags, TextInputStyle, type ModalBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { MessagingContextMenus } from './messaging.context-menus.js';
import { MessagingModals } from './messaging.modals.js';
import type { MessagingService } from './messaging.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const MESSAGE = '300000000000000001';
const BOT = '400000000000000001';
const USER = '400000000000000002';
const T = MESSAGES.en.messaging;

function menuInteraction(over: { author?: string; content?: string } = {}) {
  return {
    guildId: GUILD,
    locale: 'vi',
    replied: false,
    deferred: false,
    client: { user: { id: BOT } },
    targetMessage: {
      id: MESSAGE,
      channelId: CHANNEL,
      author: { id: over.author ?? BOT },
      content: over.content ?? 'current text',
    },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
  };
}

const modalOf = (target: { showModal: { mock: { calls: unknown[][] } } }) =>
  (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();

type Input = { custom_id: string; style: TextInputStyle; value?: string; required?: boolean };

function inputOf(modal: ReturnType<ModalBuilder['toJSON']>): Input {
  return (modal.components as unknown as Array<{ component: Input }>)[0]?.component as Input;
}

describe('message context menus', () => {
  const menus = new MessagingContextMenus({
    resolve: vi.fn().mockResolvedValue('en'),
  } as unknown as GuildLocaleService);

  it('"Edit bot message" opens a dialog holding the current text, as the only response', async () => {
    const target = menuInteraction();
    await menus.onEdit([target] as never);

    expect(target.deferReply).not.toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
    const modal = modalOf(target);
    expect(modal.custom_id).toBe(`bm-edit/${CHANNEL}/${MESSAGE}`);
    expect(modal.title).toBe(MESSAGES.vi.messaging.modal.edit.title);
    expect(inputOf(modal)).toMatchObject({
      style: TextInputStyle.Paragraph,
      value: 'current text',
      required: true,
    });
  });

  it('"Edit bot message" starts the dialog empty for a message that only has files', async () => {
    const target = menuInteraction({ content: '' });
    await menus.onEdit([target] as never);
    expect(inputOf(modalOf(target)).value).toBeUndefined();
  });

  it('"Edit bot message" refuses a message the bot did not send instead of opening a dialog', async () => {
    const target = menuInteraction({ author: USER });
    await menus.onEdit([target] as never);

    expect(target.showModal).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledWith({
      content: T.notBotMessage,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('"Reply as bot" opens a reply dialog in the message’s channel, as the only response', async () => {
    const target = menuInteraction({ author: USER });
    await menus.onReply([target] as never);

    expect(target.deferReply).not.toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
    const modal = modalOf(target);
    expect(modal.custom_id).toBe(`bm-send/${CHANNEL}/${MESSAGE}`);
    expect(modal.title).toBe(MESSAGES.vi.messaging.modal.reply.title);
  });

  it('declares exactly the two message menus', () => {
    const commands = Object.getOwnPropertyNames(MessagingContextMenus.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(commands.sort()).toEqual(['onEdit', 'onReply']);
  });

  it('names the menus within the 32 characters Discord allows, in both languages', () => {
    for (const language of ['vi', 'en'] as const) {
      const { edit, reply } = MESSAGES[language].messaging.contextMenus;
      for (const { name } of [edit, reply]) {
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(32);
      }
    }
  });
});

function build() {
  const messaging = {
    sendMessage: vi.fn().mockResolvedValue({}),
    editBotMessage: vi.fn().mockResolvedValue({ status: 'EDITED' }),
  };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const modals = new MessagingModals(
    messaging as unknown as MessagingService,
    locales as unknown as GuildLocaleService,
  );
  const submission = (content: string) => {
    const target = {
      guildId: GUILD,
      locale: 'vi',
      user: { id: USER },
      replied: false,
      deferred: false,
      fields: { getTextInputValue: vi.fn().mockReturnValue(content) },
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { modals, messaging, submission };
}

const answer = (target: { editReply: { mock: { calls: unknown[][] } } }) =>
  (target.editReply.mock.calls[0]?.[0] as { content: string }).content;

describe('MessagingModals', () => {
  it('sends the typed text to the channel in the dialog id', async () => {
    const { modals, messaging, submission } = build();
    const target = submission('typed text');
    await modals.onSend([target] as never, OTHER_CHANNEL, '-');

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(messaging.sendMessage).toHaveBeenCalledWith(
      GUILD,
      { channelId: OTHER_CHANNEL, content: 'typed text' },
      { source: 'DISCORD', userId: USER },
    );
    expect(answer(target)).toBe(T.sent);
  });

  it('replies to the message in the dialog id', async () => {
    const { modals, messaging, submission } = build();
    await modals.onSend([submission('typed text')] as never, CHANNEL, MESSAGE);

    expect(messaging.sendMessage.mock.calls[0]?.[1]).toEqual({
      channelId: CHANNEL,
      content: 'typed text',
      replyTo: { channelId: CHANNEL, messageId: MESSAGE },
    });
  });

  it('refuses a dialog submitted with only spaces', async () => {
    const { modals, messaging, submission } = build();
    const target = submission('   ');
    await modals.onSend([target] as never, CHANNEL, '-');
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(answer(target)).toBe(T.emptyContent);
  });

  it('shows what Discord said when the send is refused', async () => {
    const { modals, messaging, submission } = build();
    messaging.sendMessage.mockRejectedValue(
      new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, {
        permission: 'send',
        reason: 'Missing Permissions',
      }),
    );
    const target = submission('x');
    await modals.onSend([target] as never, CHANNEL, '-');
    expect(answer(target)).toBe('Cannot send: Missing Permissions');
  });

  it('edits the bot message named in the dialog id', async () => {
    const { modals, messaging, submission } = build();
    const target = submission('rewritten');
    await modals.onEdit([target] as never, CHANNEL, MESSAGE);

    expect(messaging.editBotMessage).toHaveBeenCalledWith(
      GUILD,
      { target: { channelId: CHANNEL, messageId: MESSAGE }, content: 'rewritten' },
      { source: 'DISCORD', userId: USER },
    );
    expect(answer(target)).toBe(T.done);
  });

  it('says the message is not the bot’s when it changed hands before the dialog was sent', async () => {
    const { modals, messaging, submission } = build();
    messaging.editBotMessage.mockResolvedValue({ status: 'NOT_BOT_MESSAGE' });
    const target = submission('rewritten');
    await modals.onEdit([target] as never, CHANNEL, MESSAGE);
    expect(answer(target)).toBe(T.notBotMessage);
  });
});
