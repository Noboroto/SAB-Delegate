/** Channels a server may designate; the service refuses the next one. */
export const CHATBOT_MAX_CHANNELS = 10;

/** Tokens per month a member may spend when the server sets no limit. */
export const CHATBOT_DEFAULT_MONTHLY_LIMIT = 100_000;

/**
 * Largest limit, bonus or spent amount. The columns are `Int`, and a sum of a
 * limit and a bonus must still fit, so the ceiling is far below 2^31.
 */
export const CHATBOT_LIMIT_MAX = 1_000_000_000;
