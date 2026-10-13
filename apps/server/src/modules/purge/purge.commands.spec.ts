import 'reflect-metadata';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { PurgeCommands } from './purge.commands.js';
import { PurgeContextMenu } from './purge.context-menu.js';
import type { PurgeFlow } from './purge.flow.js';

const CHANNEL = '200000000000000001';
const MESSAGE = '400000000000000001';

function build() {
  const flow = {
    runCommand: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
  };
  const interaction = { deferReply: vi.fn().mockResolvedValue(undefined) };
  return { flow, interaction, flowType: flow as unknown as PurgeFlow };
}

describe('/purge any', () => {
  it('defers privately first, then hands over only the options that were given', async () => {
    const { flow, interaction, flowType } = build();
    await new PurgeCommands(flowType).onAny([interaction] as never, {
      untilLink: 'link',
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(flow.runCommand).toHaveBeenCalledWith(interaction, { untilLink: 'link' });
  });

  it('passes count on its own', async () => {
    const { flow, interaction, flowType } = build();
    await new PurgeCommands(flowType).onAny([interaction] as never, { count: 7 });

    expect(flow.runCommand).toHaveBeenCalledWith(interaction, { count: 7 });
  });
});

describe('"Purge up to here"', () => {
  it('defers privately and purges everything newer than the chosen message in its channel', async () => {
    const { flow, interaction, flowType } = build();
    await new PurgeContextMenu(flowType).onPurgeUpToHere(
      [interaction] as never,
      {
        id: MESSAGE,
        channelId: CHANNEL,
      } as never,
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(flow.run).toHaveBeenCalledWith(interaction, {
      kind: 'range',
      channelId: CHANNEL,
      untilMessageId: MESSAGE,
    });
  });
});
