import { Events, Message } from "discord.js";
import {
  claimOnce,
  errNotice,
  reactToMessage,
  successNotice,
  wordGame,
} from "../ultils";

const handleWordGame = async (message: Message) => {
  if (!message.guild || message.author.bot) return;
  const authorID = message.author.id;
  const guildID = message.guild.id;
  const channelID = message.channel.id;

  if (!(await wordGame.isValidChannel(guildID, channelID))) return;

  const word = message.content.toLowerCase().trim();
  if (!word) return;
  const result = await wordGame.getWordStatus(guildID, word, authorID);
  const maxWord = await wordGame.getMax(guildID);

  switch (result) {
    case wordGame.WordGameStatus.NOT_EXIST:
      await errNotice(message, "Từ này không tồn tại trong từ điển");
      break;
    case wordGame.WordGameStatus.NOT_LINK:
      await errNotice(
        message,
        `Từ mới phải bắt đầu bằng ${await wordGame.getStarter(guildID)}`
      );
      break;
    case wordGame.WordGameStatus.SAME_AUTHOR:
      await errNotice(message, "Bạn đã nối từ trước đó");
      break;
    case wordGame.WordGameStatus.SAME_WORD:
      await errNotice(message, "Từ này đã được nối");
      break;
    case wordGame.WordGameStatus.SUCCESS:
      await wordGame.setWord(guildID, word, authorID);
      if ((await wordGame.getCount(guildID)) >= maxWord) {
        await successNotice(
          message,
          `Trò chơi kết thúc do đã đạt ${maxWord} từ. Hãy reset nếu muốn chơi tiếp nhé`
        );
      } else {
        await successNotice(message);
      }
      break;
  }
};

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(args: Message[]) {
    const message = args[0];
    // Every bot client receives this event; handle each message once.
    if (!claimOnce(`create:${message.id}`)) return;

    await reactToMessage(message);
    await handleWordGame(message);
  },
};
