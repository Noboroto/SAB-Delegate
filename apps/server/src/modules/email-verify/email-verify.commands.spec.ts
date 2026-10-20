import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { EmailVerifyCommands } from './email-verify.commands.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import type { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import type { EmailVerifyMembersService } from './email-verify-members.service.js';
import type { EmailVerifyService } from './email-verify.service.js';
import {
  GUILD,
  ROLE_A,
  ROLE_B,
  USER,
  answers,
  english,
  slash,
} from './email-verify.command-fixtures.js';

const text = MESSAGES.en['email-verify'];
const MEMBER = '100000000000000009';
const CHANNEL = '200000000000000001';

function build(defaultRoleIds: string[] = [ROLE_A]) {
  const verify = {
    status: vi.fn().mockResolvedValue({
      enabled: true,
      smtpReady: false,
      verified: 4,
      pending: 1,
      lists: 2,
      rules: 3,
      sentToday: 5,
      dailyCap: 200,
    }),
    testMail: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: vi.fn().mockResolvedValue({ defaultRoleIds }),
    patch: vi.fn().mockResolvedValue({}),
  };
  const members = {
    manualVerify: vi.fn().mockResolvedValue({ member: {}, grant: null }),
    revoke: vi.fn().mockResolvedValue({ removed: true, domain: 'x.io', grant: null }),
    exportXlsx: vi.fn().mockResolvedValue({
      buffer: Buffer.from('xlsx'),
      count: 3,
      unresolved: 0,
      fileName: 'verified-members-2026-10-21.xlsx',
      contentType: 'x',
    }),
  };
  const discord = { postButton: vi.fn().mockResolvedValue({ channelId: CHANNEL, messageId: '1' }) };
  const commands = new EmailVerifyCommands(
    verify as unknown as EmailVerifyService,
    config as unknown as EmailVerifyConfigService,
    members as unknown as EmailVerifyMembersService,
    discord as unknown as EmailVerifyDiscordService,
    english(),
  );
  return { commands, verify, config, members, discord };
}

describe('/email-verify status', () => {
  it('lists the figures and the default roles without pinging anyone', async () => {
    const { commands } = build();
    const { target } = slash();
    await commands.onStatus([target] as never);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const [content] = answers(target);
    expect(content).toContain(`${text.status.verified}: 4`);
    expect(content).toContain(`${text.status.smtp}: ${text.status.smtpNotReady}`);
    expect(content).toContain(`${text.status.sentToday}: 5 / 200`);
    expect(content).toContain(`<@&${ROLE_A}>`);
    expect(target.editReply.mock.calls[0]?.[0]).toMatchObject({ allowedMentions: { parse: [] } });
  });
});

describe('/email-verify button', () => {
  it('posts the button with only the options that were given', async () => {
    const { commands, discord } = build();
    const { target } = slash();
    await commands.onButton([target] as never, {
      channel: { id: CHANNEL },
      title: undefined,
      message: 'Hello',
      buttonText: undefined,
    });
    expect(discord.postButton).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, message: 'Hello' },
      expect.objectContaining({ userId: USER }),
    );
    expect(answers(target)).toEqual([
      text.verify.buttonPosted.replace('{channel}', `<#${CHANNEL}>`),
    ]);
  });
});

describe('/email-verify manual', () => {
  it('verifies the member and shows no address', async () => {
    const { commands, members } = build();
    const { target } = slash();
    await commands.onManual([target] as never, { user: { id: MEMBER }, email: 'a@school.edu' });
    expect(members.manualVerify).toHaveBeenCalledWith(
      GUILD,
      { userId: MEMBER, email: 'a@school.edu' },
      expect.anything(),
    );
    expect(answers(target)).toEqual([text.verify.manualDone.replace('{user}', `<@${MEMBER}>`)]);
  });

  it('adds Discord’s reason when the roles could not be given', async () => {
    const { commands, members } = build();
    members.manualVerify.mockResolvedValue({
      member: {},
      grant: {
        added: [],
        removed: [],
        refused: [],
        failure: 'Missing Permissions',
        memberGone: false,
      },
    });
    const { target } = slash();
    await commands.onManual([target] as never, { user: { id: MEMBER }, email: 'a@school.edu' });
    expect(answers(target)[0]).toContain('Missing Permissions');
  });
});

describe('/email-verify unverify', () => {
  it('previews, asks, and revokes only after the confirm button', async () => {
    const { commands, members } = build();
    const { target } = slash({ click: 'confirm' });
    await commands.onUnverify([target] as never, { user: { id: MEMBER }, removeRoles: true });
    expect(members.revoke).toHaveBeenNthCalledWith(1, GUILD, MEMBER, expect.anything(), {
      removeRoles: true,
      dryRun: true,
    });
    expect(members.revoke).toHaveBeenNthCalledWith(2, GUILD, MEMBER, expect.anything(), {
      removeRoles: true,
    });
    expect(answers(target)[0]).toBe(text.confirm.unverifyRoles.replace('{user}', `<@${MEMBER}>`));
  });

  it('keeps the verification when cancelled', async () => {
    const { commands, members } = build();
    await commands.onUnverify([slash({ click: 'cancel' }).target] as never, {
      user: { id: MEMBER },
    });
    expect(members.revoke).toHaveBeenCalledTimes(1);
  });

  it('says so, without asking, when the member was not verified', async () => {
    const { commands, members } = build();
    members.revoke.mockResolvedValue({ removed: false, domain: null, grant: null });
    const { target, prompt } = slash();
    await commands.onUnverify([target] as never, { user: { id: MEMBER } });
    expect(prompt.awaitMessageComponent).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.verify.notVerified.replace('{user}', `<@${MEMBER}>`)]);
  });
});

describe('/email-verify test-mail', () => {
  it('mails the address and shows it masked', async () => {
    const { commands, verify } = build();
    const { target } = slash();
    await commands.onTestMail([target] as never, { email: ' Ann@School.edu ' });
    expect(verify.testMail).toHaveBeenCalledWith(
      GUILD,
      { email: ' Ann@School.edu ' },
      expect.objectContaining({ source: 'DISCORD' }),
      'en',
    );
    expect(answers(target)).toEqual([
      text.verify.testMailSent.replace('{email}', 'a***@school.edu'),
    ]);
  });
});

describe('/email-verify config', () => {
  it('turns the given options into one patch and leaves the rest', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onConfig([target] as never, {
      enabled: true,
      unverifiedRole: { id: ROLE_B },
      logChannel: { id: CHANNEL },
      autoVerify: false,
      autoUnverified: true,
      verifyMessage: 'Hi',
    });
    expect(config.patch).toHaveBeenCalledWith(
      GUILD,
      {
        enabled: true,
        unverifiedRoleId: ROLE_B,
        logChannelId: CHANNEL,
        autoVerifyOnJoin: false,
        autoUnverifiedOnJoin: true,
        verifyMessage: 'Hi',
      },
      expect.anything(),
    );
    expect(answers(target)).toEqual([text.config.saved]);
  });

  it('asks for at least one option instead of writing an empty patch', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onConfig([target] as never, {});
    expect(config.patch).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.config.nothing]);
  });
});

describe('/email-verify role-add and role-remove', () => {
  it('adds a role once to the roles every verified member gets', async () => {
    const { commands, config } = build();
    await commands.onRoleAdd([slash().target] as never, { role: { id: ROLE_B } });
    expect(config.patch).toHaveBeenCalledWith(
      GUILD,
      { defaultRoleIds: [ROLE_A, ROLE_B] },
      expect.anything(),
    );

    await commands.onRoleAdd([slash().target] as never, { role: { id: ROLE_A } });
    expect(config.patch).toHaveBeenCalledTimes(1);
  });

  it('refuses a 26th role', async () => {
    const roles = Array.from(
      { length: 25 },
      (_, i) => `4000000000000000${String(i).padStart(2, '0')}`,
    );
    const { commands, config } = build(roles);
    const { target } = slash();
    await commands.onRoleAdd([target] as never, { role: { id: ROLE_B } });
    expect(config.patch).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.config.roleFull.replace('{max}', '25')]);
  });

  it('removes a role', async () => {
    const { commands, config } = build([ROLE_A, ROLE_B]);
    await commands.onRoleRemove([slash().target] as never, { role: { id: ROLE_A } });
    expect(config.patch).toHaveBeenCalledWith(
      GUILD,
      { defaultRoleIds: [ROLE_B] },
      expect.anything(),
    );
  });
});

describe('/email-verify export', () => {
  it('attaches the Excel file to a private answer', async () => {
    const { commands } = build();
    const { target } = slash();
    await commands.onExport([target] as never);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const reply = target.editReply.mock.calls[0]?.[0] as {
      content: string;
      files: Array<{ name: string }>;
    };
    expect(reply.content).toBe(text.export.sent.replace('{count}', '3'));
    expect(reply.files[0]?.name).toBe('verified-members-2026-10-21.xlsx');
  });

  it('says how many members could not be named, so the file is not taken for complete', async () => {
    const { commands, members } = build();
    members.exportXlsx.mockResolvedValue({
      buffer: Buffer.from('xlsx'),
      count: 3,
      unresolved: 2,
      fileName: 'x.xlsx',
      contentType: 'x',
    });
    const { target } = slash();
    await commands.onExport([target] as never);
    const reply = target.editReply.mock.calls[0]?.[0] as { content: string };
    expect(reply.content).toContain(text.export.unresolved.replace('{count}', '2'));
  });

  it('says so when nobody is verified, with no file', async () => {
    const { commands, members } = build();
    members.exportXlsx.mockResolvedValue({
      buffer: Buffer.alloc(0),
      count: 0,
      unresolved: 0,
      fileName: 'x.xlsx',
      contentType: 'x',
    });
    const { target } = slash();
    await commands.onExport([target] as never);
    expect(answers(target)).toEqual([text.export.empty]);
  });
});
