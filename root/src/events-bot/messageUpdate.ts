import { Events, Message } from "discord.js";
import { claimOnce, reactToMessage } from "../ultils";

export default {
  name: Events.MessageUpdate,
  once: false,
  async execute(args: Message[]) {
    const message = args[1];
    if (!message?.content) return;
    if (!claimOnce(`update:${message.id}:${message.editedTimestamp}`)) return;
    await reactToMessage(message);
  },
};
