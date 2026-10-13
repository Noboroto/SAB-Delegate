import { ButtonStyle, ComponentType, DiscordjsErrorCodes, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  CANCEL_BUTTON_ID,
  CONFIRM_BUTTON_ID,
  CONFIRM_TIMEOUT_MS,
  confirmWithButtons,
  showResult,
} from './confirm-buttons.js';

const OWNER = '300000000000000001';
const STRANGER = '300000000000000002';

const TEXTS: Parameters<typeof confirmWithButtons>[1] = {
  prompt: 'Delete 3?',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  working: 'Working...',
  cancelled: 'Cancelled.',
  expired: 'Too late.',
};

type Click = { customId: string; user: { id: string }; update: ReturnType<typeof vi.fn> };
type Options = {
  filter: (click: Pick<Click, 'customId' | 'user'>) => boolean;
  time: number;
  componentType: unknown;
};

function build(answer: { click: string } | { error: Error }) {
  const click: Click = {
    customId: 'click' in answer ? answer.click : '',
    user: { id: OWNER },
    update: vi.fn().mockResolvedValue(undefined),
  };
  const awaitMessageComponent = vi.fn((_options: Options) =>
    'error' in answer ? Promise.reject(answer.error) : Promise.resolve(click),
  );
  const interaction = {
    user: { id: OWNER },
    editReply: vi.fn().mockResolvedValue({ awaitMessageComponent }),
  };
  return { interaction, awaitMessageComponent, click };
}

describe('confirmWithButtons', () => {
  it('shows a danger Confirm and a secondary Cancel button under the question', async () => {
    const { interaction } = build({ click: CONFIRM_BUTTON_ID });
    await confirmWithButtons(interaction, TEXTS);

    const [shown] = interaction.editReply.mock.calls[0] as [
      { content: string; components: Array<{ toJSON(): { components: unknown[] } }> },
    ];
    expect(shown.content).toBe('Delete 3?');
    expect(shown.components).toHaveLength(1);
    expect(shown.components[0]?.toJSON().components).toMatchObject([
      { custom_id: CONFIRM_BUTTON_ID, label: 'Delete', style: ButtonStyle.Danger },
      { custom_id: CANCEL_BUTTON_ID, label: 'Cancel', style: ButtonStyle.Secondary },
    ]);
  });

  it('is confirmed only by the Confirm button, and says that work has started', async () => {
    const { interaction, click } = build({ click: CONFIRM_BUTTON_ID });

    expect(await confirmWithButtons(interaction, TEXTS)).toBe('confirmed');
    expect(click.update).toHaveBeenCalledWith({ content: 'Working...', components: [] });
  });

  it('is cancelled by the Cancel button', async () => {
    const { interaction, click } = build({ click: CANCEL_BUTTON_ID });

    expect(await confirmWithButtons(interaction, TEXTS)).toBe('cancelled');
    expect(click.update).toHaveBeenCalledWith({ content: 'Cancelled.', components: [] });
  });

  it('expires after a minute without an answer and takes the buttons away', async () => {
    const timeout = Object.assign(new Error('no interactions'), {
      code: DiscordjsErrorCodes.InteractionCollectorError,
    });
    const { interaction, awaitMessageComponent } = build({ error: timeout });

    expect(await confirmWithButtons(interaction, TEXTS)).toBe('expired');

    expect(CONFIRM_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(awaitMessageComponent.mock.calls[0]?.[0]).toMatchObject({
      componentType: ComponentType.Button,
      time: CONFIRM_TIMEOUT_MS,
    });
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: 'Too late.',
      components: [],
    });
  });

  it('listens only to the person who ran the command and only to its own two buttons', async () => {
    const { interaction, awaitMessageComponent } = build({ click: CONFIRM_BUTTON_ID });
    await confirmWithButtons(interaction, TEXTS);

    const { filter } = awaitMessageComponent.mock.calls[0]![0];
    expect(filter({ customId: CONFIRM_BUTTON_ID, user: { id: OWNER } })).toBe(true);
    expect(filter({ customId: CANCEL_BUTTON_ID, user: { id: OWNER } })).toBe(true);
    expect(filter({ customId: CONFIRM_BUTTON_ID, user: { id: STRANGER } })).toBe(false);
    expect(filter({ customId: 'something-else', user: { id: OWNER } })).toBe(false);
  });

  it('does not hide an error that is not a timeout', async () => {
    const { interaction } = build({ error: new Error('socket closed') });

    await expect(confirmWithButtons(interaction, TEXTS)).rejects.toThrow('socket closed');
  });
});

describe('showResult', () => {
  it('replaces the question with the outcome', async () => {
    const target = { editReply: vi.fn().mockResolvedValue(undefined), followUp: vi.fn() };
    await showResult(target, 'Deleted 3 messages.');

    expect(target.editReply).toHaveBeenCalledWith({
      content: 'Deleted 3 messages.',
      components: [],
    });
    expect(target.followUp).not.toHaveBeenCalled();
  });

  it('keeps every piece within 2000 characters, the rest as private follow-ups', async () => {
    const target = {
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const text = Array.from({ length: 60 }, (_, i) => `${i}: ${'x'.repeat(60)}`).join('\n');
    await showResult(target, text);

    const first = (target.editReply.mock.calls[0]![0] as { content: string }).content;
    expect(first.length).toBeLessThanOrEqual(2000);
    expect(target.followUp.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of target.followUp.mock.calls) {
      expect((options as { content: string }).content.length).toBeLessThanOrEqual(2000);
      expect((options as { flags: unknown }).flags).toBe(MessageFlags.Ephemeral);
    }
  });
});
