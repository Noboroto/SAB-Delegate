import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";

import { getMessageFromOption } from "../../ultils";
import { replyInChunks } from "../_shared/chunkedReply";
import { fetchReactorIds } from "../_shared/fetchAllReactors";
import {
  createPrivateThreads,
  MAX_THREAD_PREFIX_LENGTH,
} from "../_shared/privateThreads";

const commandName = "by-reaction";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Create a private thread for each member in the list")
      .addStringOption((Option) =>
        Option.setName("prefix")
          .setDescription("The prefix of the threads")
          .setMaxLength(MAX_THREAD_PREFIX_LENGTH)
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("message")
          .setDescription("The message to send to each member")
          .setMaxLength(2000)
          .setRequired(false)
      )
      .addChannelOption((Option) =>
        Option.setName("destination")
          .addChannelTypes(ChannelType.GuildText)
          .setDescription("destination channel")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;
    const prefix = interaction.options.getString("prefix").trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reaction = interaction.options.getString("emoji")?.trim() ?? "";
    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );
    const msg =
      interaction.options.getString("message") ?? "New thread is created";

    if (!messageFromID) {
      await interaction.editReply({
        content: "Please provide a valid message link",
      });
      return;
    }

    const unique_ids = await fetchReactorIds(messageFromID, reaction);

    await replyInChunks(
      interaction,
      await createPrivateThreads(
        interaction,
        targetChannel,
        prefix,
        msg,
        unique_ids
      ),
      { ephemeral: true }
    );
  },
};
