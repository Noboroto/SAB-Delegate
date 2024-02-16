import { Message } from "discord.js";

export const errNotice = (mess: Message, msg?: string) => {
  mess.react("❌");
  if (msg) mess.reply(msg);
};

export const successNotice = (mess: Message, msg?: string) => {
  mess.react("✅");
  if (msg) mess.reply(msg);
};
