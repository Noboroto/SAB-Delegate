import { Message } from "discord.js";
import fs from "fs";

// Reactions/replies fail routinely (missing permission, deleted message, unknown
// emoji); an unhandled rejection here would crash every bot in the process.
const ignoreFailure = (error: unknown) =>
  console.warn(`Reaction/reply failed: ${(error as Error)?.message ?? error}`);

export const errNotice = async (mess: Message, msg?: string) => {
  await mess.react("❌").catch(ignoreFailure);
  if (msg) await mess.reply(msg).catch(ignoreFailure);
};

export const successNotice = async (mess: Message, msg?: string) => {
  await mess.react("✅").catch(ignoreFailure);
  if (msg) await mess.reply(msg).catch(ignoreFailure);
};

const reactionDictPath = "./constants/reactionsDict.json";
const reactionsDict: Record<string, string[]> = Object.fromEntries(
  Object.entries(
    JSON.parse(fs.readFileSync(reactionDictPath, "utf8")) as Record<
      string,
      string[]
    >
  ).map(([key, reactions]) => [key.toLowerCase(), reactions])
);

const emojiPattern =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:.+?:\d{17,20}>)/u;
const reactCommandPattern =
  /react\s+(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:.+?:\d{17,20}>)/giu;

const extractReactEmojis = (text: string) =>
  [...text.matchAll(reactCommandPattern)]
    .map((match) => match[0].match(emojiPattern)?.[0])
    .filter((emoji): emoji is string => emoji !== undefined);

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A dictionary phrase must match whole words: "react no" must not fire on
// "react nothing".
const containsPhrase = (content: string, phrase: string) =>
  new RegExp(`(^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`, "u").test(content);

/**
 * Reacts to "react <emoji>" commands and to phrases from reactionsDict.json.
 * Names that are not unicode emoji resolve to the guild's custom emoji.
 */
export const reactToMessage = async (message: Message) => {
  const emojis = extractReactEmojis(message.content);
  const content = message.content.toLowerCase();
  for (const [phrase, reactions] of Object.entries(reactionsDict)) {
    if (containsPhrase(content, phrase)) emojis.push(...reactions);
  }

  for (const name of emojis) {
    const emoji =
      message.guild?.emojis.cache.find((emo) => emo.name === name) ?? name;
    await message.react(emoji).catch(ignoreFailure);
  }
};
