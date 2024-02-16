import { Events, Message } from "discord.js";
import fs from "fs";

const reactionDictPath = "./files/reactionsDict.json";
const reactionsDict = JSON.parse(fs.readFileSync(reactionDictPath, "utf8"));

export default {
  name: Events.MessageUpdate,
  once: false,
  async execute(args: Message[]) {
    const message = args[1] as Message;

    for (const key in reactionsDict) {
      if (message.content.toLowerCase().includes(key)) {
        reactionsDict[key].forEach((reaction: string) => {
          const emoji =
            message.guild?.emojis.cache.find((emo) => emo.name === reaction) ??
            reaction;

          message.react(emoji);
        });
      }
    }
  },
};
