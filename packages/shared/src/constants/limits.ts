/** Discord rejects a message longer than this many characters. */
export const MESSAGE_MAX_LENGTH = 2000;

/**
 * Business calendar for birthdays, day claims and schedules. Every
 * "which day is it" decision uses this zone, independent of the host TZ.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * An emoji as `emoji.toString()` gives it (a character or `<:name:id>`).
 * Discord caps an autocomplete choice value, which carries it, at 100 characters.
 */
export const REACTION_EMOJI_MAX_LENGTH = 100;
