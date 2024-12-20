import { Events, Message } from "discord.js";
import fs from "fs";

const reactionDictPath = "./constants/reactionsDict.json";
const reactionsDict = JSON.parse(fs.readFileSync(reactionDictPath, "utf8"));

const extractReactEmojis = (text: string) => {
  // Pattern với flag global (g) để lấy tất cả matches
  const pattern =
    /react\s+(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:.+?:\d{17,20}>)/giu;

  // Lấy tất cả các matches
  const matches = [...text.matchAll(pattern)];

  // Pattern để tách riêng emoji từ mỗi match
  const emojiPattern =
    /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:.+?:\d{17,20}>)/gu;

  // Lấy emoji từ mỗi match và lọc null
  return matches
    .map((match) => match[0].match(emojiPattern)?.[0])
    .filter((emoji) => emoji !== undefined) as string[];
};

const reactToMessage = (message: Message) => {
  const emojisStr: String[] = extractReactEmojis(message.content);
  for (const key in reactionsDict) {
    if (message.content.toLowerCase().includes(key)) {
      reactionsDict[key].forEach((reaction: string) => {
        emojisStr.push(reaction);
      });
    }
  }
  emojisStr.forEach((str: string) => {
    const emoji =
      message.guild?.emojis.cache.find((emo) => emo.name === str) ?? str;
    message.react(emoji);
  });
};

export default {
  name: Events.MessageUpdate,
  once: false,
  async execute(args: Message[]) {
    const message = args[1] as Message;
    reactToMessage(message);
  },
};
