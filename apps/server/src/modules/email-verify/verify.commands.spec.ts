import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { MessageFlags, type ModalBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import type { EmailVerifyMembersService } from './email-verify-members.service.js';
import { GUILD, USER, answers, english, slash } from './email-verify.command-fixtures.js';
import { VerifyCommands } from './verify.commands.js';

const text = MESSAGES.en['email-verify'];

function build(deleted = true) {
  const config = { get: vi.fn().mockResolvedValue({ verifyMessage: null }) };
  const members = { deleteOwnData: vi.fn().mockResolvedValue(deleted) };
  const commands = new VerifyCommands(
    config as unknown as EmailVerifyConfigService,
    members as unknown as EmailVerifyMembersService,
    english(),
  );
  return { commands, members };
}

describe('/verify start', () => {
  it('opens the address form for this server as the only response', async () => {
    const { commands } = build();
    const { target } = slash();
    await commands.onStart([target] as never);
    expect(target.deferReply).not.toHaveBeenCalled();
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();
    expect(modal.custom_id).toBe(`ev/email/${GUILD}`);
  });

  it('is refused outside a server', async () => {
    const { commands } = build();
    const { target } = slash({ guildId: null });
    await expect(commands.onStart([target] as never)).rejects.toMatchObject({
      code: 'GUILD_NOT_FOUND',
    });
  });
});

describe('/verify delete-data', () => {
  it('erases the caller’s own data and answers privately', async () => {
    const { commands, members } = build(true);
    const { target } = slash();
    await commands.onDeleteData([target] as never);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(members.deleteOwnData).toHaveBeenCalledWith(GUILD, USER);
    expect(answers(target)).toEqual([text.verify.deleted]);
  });

  it('says when there was nothing to delete', async () => {
    const { commands } = build(false);
    const { target } = slash();
    await commands.onDeleteData([target] as never);
    expect(answers(target)).toEqual([text.verify.nothingToDelete]);
  });
});
