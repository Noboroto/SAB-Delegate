import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { replyInChunks } from "../_shared/chunkedReply";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "edit-prefix";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("edit private threads prefix")
      .addStringOption((Option) =>
        Option.setName("old-prefix")
          .setDescription("The old prefix of the threads")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("new-prefix")
          .setDescription("The new prefix of the threads")
          .setMaxLength(100)
          .setRequired(true)
      )
      .addChannelOption((Option) =>
        Option.setName("destination")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.GuildForum)
          .setDescription("destination channel")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    //const guild = interaction.client.guilds.cache.get('Guild ID');
    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;
    const oldPrefix = interaction.options.getString("old-prefix").trim();
    const newPrefix = interaction.options.getString("new-prefix").trim();
    if (!oldPrefix) {
      await interaction.reply({
        content: "Old prefix must not be empty!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!("threads" in targetChannel)) {
      await interaction.reply({
        content: "Threads cannot be listed in this channel!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Active threads only: archived ones are usually history people want kept.
    const threads = (await targetChannel.threads.fetch()).threads;
    const filteredThreads = threads.filter((thread) =>
      thread.name.startsWith(oldPrefix)
    );

    let counter = 0;
    const failures: string[] = [];
    for (const thread of filteredThreads.values()) {
      // Only the leading prefix changes, never a later occurrence in the name.
      const newName = newPrefix + thread.name.slice(oldPrefix.length);
      try {
        await thread.setName(newName);
        counter++;
      } catch (error) {
        console.error(`Failed to rename thread ${thread.id}`, error);
        failures.push(`${thread.name}: ${errorMessage(error)}`);
      }
    }

    await replyInChunks(
      interaction,
      `Done ${counter} thread(s)!` +
        (failures.length
          ? `\nFailed ${failures.length}:\n${failures.join("\n")}`
          : ""),
      { ephemeral: true }
    );
  },
};
