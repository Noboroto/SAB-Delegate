import { MESSAGE_MAX_LENGTH, splitMessage } from '@sab/shared';

const FENCE = '```';

/** Room a chunk may need to close a code block at its end and reopen it at the next start. */
const FENCE_ROOM = FENCE.length * 2 + 2;

/** Whether the line opens or closes a code block (a block opened and closed on one line does neither). */
function togglesFence(line: string): boolean {
  const text = line.trimStart();
  return text.startsWith(FENCE) && !text.slice(FENCE.length).includes(FENCE);
}

/**
 * Splits an answer into Discord messages and ends the last one with the
 * member's remaining-quota line. The line is reserved out of every chunk's
 * budget, so whichever chunk turns out last has room for it and none can pass
 * the limit. A code block cut by a split is closed at the end of its chunk and
 * reopened in the next, and one the answer never closed is closed before the
 * footer, so the footer is never drawn inside code. An answer with no visible
 * text is just the line.
 */
export function formatReply(body: string, footer: string): string[] {
  const line = `\n${footer}`;
  if (body.trim() === '') return [footer];
  const room = body.includes(FENCE) ? FENCE_ROOM : 0;
  const pieces = splitMessage(body, MESSAGE_MAX_LENGTH - line.length - room);
  let open = false;
  const chunks = pieces.map((piece) => {
    let text = open ? `${FENCE}\n${piece}` : piece;
    for (const each of piece.split('\n')) {
      if (togglesFence(each)) open = !open;
    }
    if (open) text += `\n${FENCE}`;
    return text;
  });
  chunks[chunks.length - 1] += line;
  return chunks;
}
