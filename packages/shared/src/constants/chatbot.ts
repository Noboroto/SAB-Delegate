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
