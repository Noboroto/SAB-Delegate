import 'reflect-metadata';
import { EMAIL_BLOCK_PATTERNS_MAX, MESSAGES } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { EmailBlockCommands } from './email-block.commands.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import { GUILD, answers, english, slash } from './email-verify.command-fixtures.js';

const text = MESSAGES.en['email-verify'];

function build(patterns: string[] = ['*@old.io']) {
  const config = {
    blocklist: vi.fn().mockResolvedValue({ patterns }),
    setBlocklist: vi.fn().mockResolvedValue({ patterns }),
  };
  const commands = new EmailBlockCommands(config as unknown as EmailVerifyConfigService, english());
  return { commands, config };
}

describe('/email-block add', () => {
  it('adds the new patterns, lower-cased, and counts only those that were new', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, {
      patterns: '*@Mailinator.com, *@old.io;*@mailinator.com',
    });
    expect(config.setBlocklist).toHaveBeenCalledWith(
      GUILD,
      { patterns: ['*@old.io', '*@mailinator.com'] },
      expect.objectContaining({ source: 'DISCORD' }),
    );
    expect(answers(target)).toEqual([text.block.added.replace('{count}', '1')]);
  });

  it('refuses text that is not an address pattern and changes nothing', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, { patterns: '*@ok.io, drop!table' });
    expect(config.setBlocklist).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.block.invalid]);
  });

  it('stops at the limit', async () => {
    const full = Array.from({ length: EMAIL_BLOCK_PATTERNS_MAX }, (_, i) => `*@d${i}.io`);
    const { commands, config } = build(full);
    const { target } = slash();
    await commands.onAdd([target] as never, { patterns: '*@one-more.io' });
    expect(config.setBlocklist).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([
      text.block.limit.replace('{max}', String(EMAIL_BLOCK_PATTERNS_MAX)),
    ]);
  });
});

describe('/email-block remove, list and clear', () => {
  it('removes the named patterns and says when none was blocked', async () => {
    const { commands, config } = build(['*@a.io', '*@b.io']);
    await commands.onRemove([slash().target] as never, { patterns: '*@A.io' });
    expect(config.setBlocklist).toHaveBeenCalledWith(
      GUILD,
      { patterns: ['*@b.io'] },
      expect.anything(),
    );

    const none = slash();
    await commands.onRemove([none.target] as never, { patterns: '*@zzz.io' });
    expect(answers(none.target)).toEqual([text.block.notFound]);
    expect(config.setBlocklist).toHaveBeenCalledTimes(1);
  });

  it('lists the patterns, or says nothing is blocked', async () => {
    const filled = build(['*@a.io']);
    const one = slash();
    await filled.commands.onList([one.target] as never);
    expect(answers(one.target)[0]).toContain('- `*@a.io`');

    const empty = build([]);
    const none = slash();
    await empty.commands.onList([none.target] as never);
    expect(answers(none.target)).toEqual([text.block.listEmpty]);
  });

  it('clears only after the confirm button', async () => {
    const yes = build();
    await yes.commands.onClear([slash({ click: 'confirm' }).target] as never);
    expect(yes.config.setBlocklist).toHaveBeenCalledWith(
      GUILD,
      { patterns: [] },
      expect.anything(),
    );

    const no = build();
    await no.commands.onClear([slash({ click: 'cancel' }).target] as never);
    expect(no.config.setBlocklist).not.toHaveBeenCalled();
  });
});
