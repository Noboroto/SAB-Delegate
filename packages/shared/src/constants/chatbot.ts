/** Channels a server may designate; the service refuses the next one. */
export const CHATBOT_MAX_CHANNELS = 10;

/** Tokens per month a member may spend when the server sets no limit. */
export const CHATBOT_DEFAULT_MONTHLY_LIMIT = 100_000;

/**
 * Largest limit, bonus or spent amount. The columns are `Int`, and a sum of a
 * limit and a bonus must still fit, so the ceiling is far below 2^31.
 */
export const CHATBOT_LIMIT_MAX = 1_000_000_000;

/** Turns older than this are deleted by the daily retention job. */
export const CHATBOT_HISTORY_RETENTION_DAYS = 90;

/** How many of a member's latest turns are fed back into the prompt. */
export const CHATBOT_RECENT_TURNS = 6;

/** Cap on the characters (question plus answer) the replayed turns may add to the prompt. */
export const CHATBOT_RECENT_TURNS_MAX_CHARS = 6000;

/** Longest question a turn stores; the column CHECK says the same. */
export const CHATBOT_TURN_QUESTION_MAX_CHARS = 6000;

/** Longest answer a turn stores; the column CHECK says the same. */
export const CHATBOT_TURN_ANSWER_MAX_CHARS = 12_000;

/** Largest serialized context snapshot a turn stores. */
export const CHATBOT_TURN_CONTEXT_MAX_BYTES = 64 * 1024;

/** Earlier channel messages read for each reply (the live window, never stored). */
export const CHATBOT_CONTEXT_MESSAGES = 50;

/** Characters of channel transcript sent to the model; the oldest lines go first. */
export const CHATBOT_CONTEXT_MAX_CHARS = 12_000;

/** One transcript line is cut here so a single wall of text cannot take the budget. */
export const CHATBOT_CONTEXT_LINE_MAX_CHARS = 600;

/** Largest picture sent to the model. */
export const CHATBOT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** Largest .txt file that is downloaded. */
export const CHATBOT_TEXT_MAX_BYTES = 100 * 1024;

/** Characters of a .txt file the model gets; the rest is cut with a notice. */
export const CHATBOT_TEXT_MAX_CHARS = 24_000;

/** Pictures taken from the message and the one it replies to. */
export const CHATBOT_MAX_IMAGES = 3;

/** Text files taken from the message and the one it replies to. */
export const CHATBOT_MAX_TEXT_FILES = 1;

/** Longest memory summary; the prompt clips to it as well, so a stored longer one cannot flood it. */
export const CHATBOT_SUMMARY_MAX_CHARS = 1500;

/** Replies of one member between two rewrites of their memory summaries. */
export const CHATBOT_SUMMARY_EVERY_TURNS = 6;
