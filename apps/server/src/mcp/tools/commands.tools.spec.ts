import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandsCatalogService } from '../../modules/system/commands-catalog.service.js';
import { startMcp } from '../mcp.test-harness.js';
import { checkToolRow } from '../tool-definition.js';
import { COMMANDS_TOOLS } from './commands.tools.js';

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('commands tools', () => {
  let list: ReturnType<typeof vi.fn>;
  let mcp: Mcp;

  beforeEach(async () => {
    list = vi.fn(() => [
      {
        name: 'birthday',
        description: 'Sinh nhật',
        defaultMemberPermissions: null,
        guildOnly: true,
        subcommands: [{ name: 'birthday add', description: 'Thêm' }],
      },
    ]);
    mcp = await startMcp({
      rows: COMMANDS_TOOLS,
      mode: 'READ',
      services: new Map<never, unknown>([[CommandsCatalogService as never, { list }]]),
    });
  });
  afterEach(async () => {
    await mcp.close();
  });

  it('passes the registry row checks', () => {
    const classes = new Map<string, { prototype: object }>([
      [CommandsCatalogService.name, CommandsCatalogService],
    ]);
    expect(COMMANDS_TOOLS.flatMap((row) => checkToolRow(row, classes))).toEqual([]);
  });

  it('is shown to a READ key and takes no server and no access check', async () => {
    expect(mcp.registeredTools.has('commands_list')).toBe(true);
    const reply = await mcp.call('commands_list', {});
    expect(reply.failed).toBe(false);
    expect(reply.json()).toMatchObject({ data: [{ name: 'birthday' }] });
    expect(mcp.assertManageGuild).not.toHaveBeenCalled();
  });

  it('uses the default language without a locale and the given one with it', async () => {
    await mcp.call('commands_list', {});
    expect(list).toHaveBeenLastCalledWith('vi');
    await mcp.call('commands_list', { locale: 'en' });
    expect(list).toHaveBeenLastCalledWith('en');
  });

  it('refuses a language the bot does not have', async () => {
    const reply = await mcp.call('commands_list', { locale: 'xx' });
    expect(reply.failed).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});
