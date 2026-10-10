import { Attachment, Message } from "discord.js";

export type MessageCopy = { content: string; files: Attachment[] };

/** Content and attachments of `source`, or null when there is nothing to copy. */
export const buildMessageCopy = (source: Message): MessageCopy | null => {
  const copy: MessageCopy = {
    content: source.content,
    files: [...source.attachments.values()],
  };
  if (!copy.content && copy.files.length === 0) return null;
  return copy;
};
