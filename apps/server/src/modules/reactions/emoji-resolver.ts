/**
 * One emoji as it appears in message text: a unicode pictograph, or a custom
 * emoji as Discord writes it (`<:name:id>` / `<a:name:id>` with a 17 to 20
 * digit id). A source string, not a regex, so each user compiles its own flags.
 */
export const EMOJI_SOURCE = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:\w+:\d{17,20}>)`;

/**
 * The slice of a server that emoji lookup reads. Structural for the reason
 * given in `discord/helpers/reply.ts`: the discord.js classes of an event and
 * the ones imported here are separate declarations to the compiler.
 */
type EmojiGuild<Emoji extends { name: string | null }> = {
  readonly emojis: {
    readonly cache: { find(predicate: (emoji: Emoji) => boolean): Emoji | undefined };
  };
};

/**
 * What to hand to `message.react` for a token from the dictionary or from a
 * "react ..." command. A unicode emoji or a `<:name:id>` string is understood
 * by discord.js as it is; any other word names one of the server's custom
 * emoji and is looked up by exact name. A word the server has no emoji for is
 * returned unchanged: reacting with it fails at Discord, which the caller
 * treats like any other failed reaction.
 */
export function resolveReactionEmoji<Emoji extends { name: string | null }>(
  guild: EmojiGuild<Emoji> | null,
  token: string,
): Emoji | string {
  return guild?.emojis.cache.find((emoji) => emoji.name === token) ?? token;
}
