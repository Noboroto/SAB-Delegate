import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

// Discord rejects any message body over 2000 characters.
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Splits text on line boundaries into pieces of at most `max` characters.
 * A single line longer than `max` is cut hard, since there is no better seam.
 */
export const splitMessage = (
  text: string,
  max: number = MAX_MESSAGE_LENGTH
): string[] => {
  const chunks: string[] = [];
  let current: string | undefined;

  for (const line of text.split("\n")) {
    for (let start = 0; start === 0 || start < line.length; start += max) {
      const part = line.slice(start, start + max);
      if (current === undefined) {
        current = part;
      } else if (current.length + 1 + part.length > max) {
        chunks.push(current);
        current = part;
      } else {
        current += "\n" + part;
      }
    }
  }
  if (current !== undefined) chunks.push(current);

  // Discord also rejects whitespace-only bodies.
  const nonEmpty = chunks.filter((chunk) => chunk.trim().length > 0);
  return nonEmpty.length > 0 ? nonEmpty : ["(empty)"];
};

/** Sends `text` as one or more messages: first via `sendFirst`, the rest via `sendRest`. */
export const sendInChunks = async (
  text: string,
  sendFirst: (content: string) => Promise<unknown>,
  sendRest: (content: string) => Promise<unknown> = sendFirst
): Promise<void> => {
  const [first, ...rest] = splitMessage(text);
  await sendFirst(first);
  for (const chunk of rest) {
    await sendRest(chunk);
  }
};

/**
 * Answers the interaction with `text`, whatever its length. Works before a
 * reply, after deferReply, and after an earlier reply (then everything is a
 * follow-up).
 */
export const replyInChunks = async (
  interaction: ChatInputCommandInteraction,
  text: string,
  { ephemeral = false }: { ephemeral?: boolean } = {}
): Promise<void> => {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  const followUp = (content: string) =>
    interaction.followUp({ content, flags });

  let sendFirst: (content: string) => Promise<unknown> = followUp;
  if (interaction.deferred && !interaction.replied) {
    sendFirst = (content) => interaction.editReply({ content });
  } else if (!interaction.deferred && !interaction.replied) {
    sendFirst = (content) => interaction.reply({ content, flags });
  }

  await sendInChunks(text, sendFirst, followUp);
};
