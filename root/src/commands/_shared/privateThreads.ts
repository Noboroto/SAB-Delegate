import {
  ChannelType,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { errorMessage } from "./errorMessage";

// Thread names are `${prefix}-${username}`; usernames take up to 32 characters
// and Discord caps names at 100.
export const MAX_THREAD_PREFIX_LENGTH = 60;

/**
 * Creates one private thread per member id inside `targetChannel` and returns
 * the summary line for the invoker. Discord only allows private threads in
 * plain text channels.
 */
export const createPrivateThreads = async (
  interaction: ChatInputCommandInteraction,
  targetChannel: TextChannel,
  prefix: string,
  msg: string,
  ids: string[]
): Promise<string> => {
  if (targetChannel?.type !== ChannelType.GuildText) {
    return "Private threads can only be created in text channels!";
  }

  // The cache only holds members seen so far; the full list needs a fetch.
  const members = await interaction.guild.members.fetch();

  const tasks = ids.map(async (id) => {
    const member = members.get(id);
    if (!member) throw new Error(`Member ${id} not found`);
    const latestThread = await targetChannel.threads.create({
      type: ChannelType.PrivateThread,
      name: `${prefix}-${member.user.username}`,
      autoArchiveDuration: 10080,
      reason: `Create thread for ${prefix}`,
      invitable: false,
    });
    await latestThread.members.add(member);
    await latestThread.members.add(interaction.user);
    await latestThread.send({
      content: `${msg}`,
    });
  });

  const results = await Promise.allSettled(tasks);
  const completed = results.filter((result) => result.status === "fulfilled");
  const errors = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    .map((result) => errorMessage(result.reason));
  const summary =
    `Done ${completed.length}/${results.length} thread(s)!` +
    (errors.length ? `\nErrors: ${errors.join(", ")}` : "");

  console.info(summary);
  return summary;
};
