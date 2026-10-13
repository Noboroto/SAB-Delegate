import { MESSAGE_MAX_LENGTH, splitMessage } from '@sab/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  DiscordjsErrorCodes,
  MessageFlags,
} from 'discord.js';

/** How long the buttons wait for an answer; the person sees nothing happen after it. */
export const CONFIRM_TIMEOUT_MS = 60_000;

export const CONFIRM_BUTTON_ID = 'confirm';
export const CANCEL_BUTTON_ID = 'cancel';

type ConfirmOutcome = 'confirmed' | 'cancelled' | 'expired';

type ConfirmTexts = {
  /** The question, with what would happen. */
  prompt: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Shown while the confirmed work runs. */
  working: string;
  cancelled: string;
  expired: string;
};

type ButtonClick = {
  readonly customId: string;
  readonly user: { readonly id: string };
  update(options: { content: string; components: [] }): Promise<unknown>;
};

type PromptMessage = {
  awaitMessageComponent(options: {
    componentType: ComponentType.Button;
    filter: (click: ButtonClick) => boolean;
    time: number;
  }): Promise<ButtonClick>;
};

/**
 * What the buttons need of an interaction that is already deferred. Structural
 * for the reason given in `discord/helpers/reply.ts`.
 */
type ConfirmTarget = {
  readonly user: { readonly id: string };
  editReply(options: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
  }): Promise<PromptMessage>;
};

/**
 * Asks the person who ran a command to confirm a destructive step with two
 * buttons, and waits at most `CONFIRM_TIMEOUT_MS`. Only that person's clicks
 * count. Nothing is done here beyond the question: the caller runs the real
 * work when (and only when) the outcome is `confirmed`, by calling the same
 * service method the preview came from with `dryRun` off.
 *
 * The answer is read with a per-message collector rather than a registered
 * button handler: the buttons carry no state, so nothing has to survive a
 * restart, and a restart simply leaves a prompt nobody can confirm.
 */
export async function confirmWithButtons(
  interaction: ConfirmTarget,
  texts: ConfirmTexts,
): Promise<ConfirmOutcome> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONFIRM_BUTTON_ID)
      .setLabel(texts.confirmLabel)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CANCEL_BUTTON_ID)
      .setLabel(texts.cancelLabel)
      .setStyle(ButtonStyle.Secondary),
  );
  const prompt = await interaction.editReply({ content: texts.prompt, components: [row] });

  let click: ButtonClick;
  try {
    click = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (candidate) =>
        candidate.user.id === interaction.user.id &&
        (candidate.customId === CONFIRM_BUTTON_ID || candidate.customId === CANCEL_BUTTON_ID),
      time: CONFIRM_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isCollectorTimeout(error)) throw error;
    await interaction.editReply({ content: texts.expired, components: [] });
    return 'expired';
  }

  if (click.customId === CONFIRM_BUTTON_ID) {
    await click.update({ content: texts.working, components: [] });
    return 'confirmed';
  }
  await click.update({ content: texts.cancelled, components: [] });
  return 'cancelled';
}

/** The collector gives up with this code when nobody answered in time. */
function isCollectorTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === DiscordjsErrorCodes.InteractionCollectorError
  );
}

/** What `showResult` needs of the interaction the buttons were shown on. */
type ResultTarget = {
  editReply(options: { content: string; components: [] }): Promise<unknown>;
  followUp(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
};

/**
 * Puts the outcome of the confirmed work where the question was (the buttons
 * go), splitting a long text so no piece passes the 2000 characters Discord
 * accepts; the pieces after the first are private follow-ups.
 */
export async function showResult(interaction: ResultTarget, text: string): Promise<void> {
  const [first = '', ...rest] = splitMessage(text, MESSAGE_MAX_LENGTH);
  await interaction.editReply({ content: first, components: [] });
  for (const chunk of rest) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}
