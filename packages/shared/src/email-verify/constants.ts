/** Digits in the code mailed to a member. */
export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MINUTES = 15;
/** Wrong codes a pending verification allows before it is closed. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
/** Mails one pending verification may cause, the first one included. */
export const EMAIL_MAX_SENDS_PER_PENDING = 5;
/** Mails one member may ask for per server per day, whatever happened to the earlier ones. */
export const EMAIL_USER_DAILY_MAIL_CAP = 10;
/** Mails one server may send per day. */
export const EMAIL_GUILD_DAILY_MAIL_CAP = 200;
/** Access rules per server. */
export const ACCESS_RULES_MAX = 25;
/** Conditions (leaves) in one rule, groups not counted. */
export const ACCESS_RULE_TERMS_MAX = 20;
/** Levels of groups in one rule's condition, the outermost included. */
export const ACCESS_CONDITION_DEPTH_MAX = 4;
/** Longest text expression of one rule's condition. */
export const ACCESS_CONDITION_TEXT_MAX = 2000;
export const EMAIL_BLOCK_PATTERNS_MAX = 100;
export const EMAIL_LISTS_MAX = 25;
export const EMAIL_LIST_ENTRIES_MAX = 20000;
/** Addresses one add or remove request may carry. */
export const EMAIL_LIST_BATCH_MAX = 5000;
export const EMAIL_VERIFY_MESSAGE_MAX = 1000;
/** Longest address, as RFC 5321 allows. */
export const EMAIL_ADDRESS_MAX = 254;
