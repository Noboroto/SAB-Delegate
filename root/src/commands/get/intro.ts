import {
  SlashCommandSubcommandBuilder,
  TextChannel,
  ChatInputCommandInteraction,
  FetchMessagesOptions,
  Collection,
  Message,
  MessageFlags,
} from "discord.js";
import { configManager } from "../../ultils";
import { replyInChunks } from "../_shared/chunkedReply";

const BATCH_SIZE = 100;

// Deferred reply removes the 3s limit, so the scan can cover a long intro channel.
const INTRO_SCAN_LIMIT = 10000;

// Newest batch first; stops after `limit` messages in total.
const lots_of_messages_getter = async (
  channel: TextChannel,
  limit_msg = INTRO_SCAN_LIMIT
) => {
  const batches: Collection<string, Message<true>>[] = [];
  let total = 0;
  let before: string | undefined;

  while (total < limit_msg) {
    const requested = Math.min(BATCH_SIZE, limit_msg - total);
    const options: FetchMessagesOptions = { limit: requested, cache: false };
    if (before) {
      options.before = before;
    }

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    batches.push(messages);
    total += messages.size;
    before = messages.last().id;

    if (messages.size < requested) break;
  }

  return batches;
};

const commandName = "intro";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "get first introduction of a user in intro channels (set by admin)"
      )

      .addUserOption((Option) =>
        Option.setName("user")
          .setDescription("user to get introduction")
          .setRequired(true)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const channelID = await configManager.getIntroChannelId(
      interaction.guildId
    );
    if (!channelID) {
      await interaction.reply({
        content: "No introduction channel set",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Scanning the intro channel outlives the 3s reply window.
    await interaction.deferReply();

    const user = interaction.options.getUser("user");
    let message: Message<true> = null;
    try {
      const srcChannel = (await interaction.client.channels.fetch(
        channelID
      )) as TextChannel;
      const batches = await lots_of_messages_getter(srcChannel);

      // Oldest batch first, oldest message first: the user's first introduction.
      for (const messages of batches.reverse()) {
        const found = [...messages.values()]
          .reverse()
          .find((msg) => msg.author.id === user.id);
        if (found) {
          message = found;
          break;
        }
      }
    } catch (error) {
      console.error("get intro failed to read the introduction channel", error);
      await interaction.editReply(
        "Cannot read the introduction channel, check the bot's permissions."
      );
      return;
    }

    if (!message) {
      await interaction.editReply(
        `User has no introduction in the last ${INTRO_SCAN_LIMIT} messages`
      );
      return;
    }

    await replyInChunks(
      interaction,
      `Jump to message ${user}'s [introduction](${message.url}):\n\n${message.content}`
    );
  },
};
