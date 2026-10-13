/** A message to copy from; structural so any discord.js `Message` fits. */
type CopySource<File> = {
  readonly content: string;
  readonly attachments: { values(): Iterable<File> };
};

type MessageCopy<File> = { content: string; files: File[] };

/**
 * Content and attachments of `source`, ready to send as a new message, or
 * `null` when there is nothing to copy (no text and no attachment: Discord
 * rejects an empty message).
 */
export function buildMessageCopy<File>(source: CopySource<File>): MessageCopy<File> | null {
  const copy: MessageCopy<File> = {
    content: source.content,
    files: [...source.attachments.values()],
  };
  if (copy.content === '' && copy.files.length === 0) return null;
  return copy;
}
