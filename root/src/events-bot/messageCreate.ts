import { Events, Message } from "discord.js";
import { errNotice, successNotice, wordGame } from "../ultils";
import fs from "fs";

const reactionDictPath = "./files/reactionsDict.json";
if (!fs.existsSync(reactionDictPath)) {
	fs.writeFileSync(reactionDictPath, "{ \"React 👌\": [\"👌\"], \"react ok\": [\"👌\"], \"react error\": [\"❌\"], \"react warning\": [\"⚠️\"], \"react info\": [\"ℹ️\"], \"react debug\": [\"🐛\"], \"react success\": [\"✅\"], \"react fatal\": [\"💀\"], \"react yes no\": [\"yes\", \"no\"], \"react yes\": [\"yes\"], \"react no\": [\"no\"], \"react ok cancel\": [\"ok\", \"❌\"] }");
}
const reactionsDict = JSON.parse(fs.readFileSync(reactionDictPath, "utf8"));

const reactToMessage = (message: Message) => {
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
};

const handleWordGame = async (message: Message) => {
  const authorID = message.author.id;
  const guildID = message.guild.id;
  const channelID = message.channel.id;

  if (message.author.bot) return;
  if (!(await wordGame.isValidChannel(guildID, channelID))) return;

  const word = message.content.toLowerCase().trimEnd().trimStart();
  const result = await wordGame.getWordStatus(guildID, word, authorID);
  const maxWord = await wordGame.getMax(guildID);

  switch (result) {
    case wordGame.WordGameStatus.NOT_EXIST:
      errNotice(message, "Từ này không tồn tại trong từ điển");
      break;
    case wordGame.WordGameStatus.NOT_LINK:
      errNotice(
        message,
        `Từ mới phải bắt đầu bằng ${await wordGame.getStarter(guildID)}`
      );
      break;
    case wordGame.WordGameStatus.SAME_AUTHOR:
      errNotice(message, "Bạn đã nối từ trước đó");
      break;
    case wordGame.WordGameStatus.SAME_WORD:
      errNotice(message, "Từ này đã được nối");
      break;
    case wordGame.WordGameStatus.SUCCESS:
      await wordGame.setWord(guildID, word, authorID);
      successNotice(message);
      break;
    case wordGame.WordGameStatus.MAX_WORD:
      successNotice(
        message,
        `Trò chơi kết thú do đã vượt quá ${maxWord} từ.Hãy reset nếu muốn chơi tiếp nhé`
      );
      break;
  }
};

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(args: Message[]) {
    const message = args[0] as Message;

    reactToMessage(message);
    handleWordGame(message);
  },
};
