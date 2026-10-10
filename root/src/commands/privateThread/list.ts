import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { replyInChunks } from "../_shared/chunkedReply";
import {
  createPrivateThreads,
  MAX_THREAD_PREFIX_LENGTH,
} from "../_shared/privateThreads";

const commandName = "list";

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
        Option.setName("ids")
          .setDescription("seperate by comma, can be present as mention")
          .setRequired(true)
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
    const msg =
      interaction.options.getString("message") ?? "New thread is created";

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ids = interaction.options
      .getString("ids")
      .replaceAll(">", "")
      .replaceAll("<", "")
      .replaceAll("@", "")
      .split(/[\s,]+/);
    const unique_ids = [...new Set(ids)];

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
