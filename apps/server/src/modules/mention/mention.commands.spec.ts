import 'reflect-metadata';
import type { Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { MentionCommands } from './mention.commands.js';
import { MentionContextMenus } from './mention.context-menus.js';
import type { MentionResponder } from './mention.responder.js';
import { ThreadEveryoneCommands } from './thread-everyone.commands.js';

const ROLE = '100000000000000041';

function responder() {
  return {
    byReaction: vi.fn().mockResolvedValue(undefined),
    notReact: vi.fn().mockResolvedValue(undefined),
    notReactOf: vi.fn().mockResolvedValue(undefined),
    everyone: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MentionCommands', () => {
  it('hands by-a-reaction to the responder unchanged', async () => {
    const fake = responder();
    const commands = new MentionCommands(fake as unknown as MentionResponder);
    const interaction = {};
    const options = { messageLink: 'l', emoji: 'e', replyMessage: 'r', content: 'c' };
    await commands.onByReaction([interaction] as never, options);
    expect(fake.byReaction).toHaveBeenCalledWith(interaction, options);
  });

  it('turns the role option into its id for not-react', async () => {
    const fake = responder();
    const commands = new MentionCommands(fake as unknown as MentionResponder);
    const interaction = {};
    await commands.onNotReact([interaction] as never, {
      messageLink: 'l',
      role: { id: ROLE },
      isReply: true,
      includeBots: false,
      onlyInChannel: false,
      content: 'c',
    });
    expect(fake.notReact).toHaveBeenCalledWith(interaction, {
      messageLink: 'l',
      roleId: ROLE,
      isReply: true,
      includeBots: false,
      onlyInChannel: false,
      content: 'c',
    });
  });

  it('leaves the role out when none was given', async () => {
    const fake = responder();
    const commands = new MentionCommands(fake as unknown as MentionResponder);
    await commands.onNotReact([{}] as never, { messageLink: 'l' });
    expect(fake.notReact).toHaveBeenCalledWith({}, { messageLink: 'l', roleId: undefined });
  });

  it('runs everyone through the responder', async () => {
    const fake = responder();
    const commands = new MentionCommands(fake as unknown as MentionResponder);
    await commands.onEveryone([{}] as never, { content: 'c' });
    expect(fake.everyone).toHaveBeenCalledWith({}, { content: 'c' });
  });
});

describe('ThreadEveryoneCommands', () => {
  it('is the same command as /mention everyone', async () => {
    const fake = responder();
    const commands = new ThreadEveryoneCommands(fake as unknown as MentionResponder);
    const interaction = {};
    await commands.onEveryone([interaction] as never, { content: 'c', replyMessage: 'r' });
    expect(fake.everyone).toHaveBeenCalledWith(interaction, { content: 'c', replyMessage: 'r' });
  });
});

describe('MentionContextMenus', () => {
  it('mentions the non-reactors of the message that was clicked', async () => {
    const fake = responder();
    const menus = new MentionContextMenus(fake as unknown as MentionResponder);
    const interaction = {};
    const message = { id: 'm', channelId: 'c', guildId: 'g' } as unknown as Message;
    await menus.onNonReactors([interaction] as never, message);
    expect(fake.notReactOf).toHaveBeenCalledWith(interaction, message);
  });
});
