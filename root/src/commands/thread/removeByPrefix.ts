import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { replyInChunks } from "../_shared/chunkedReply";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "remove-by-prefix";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("remove private threads")
      .addStringOption((Option) =>
        Option.setName("prefix")
          .setDescription("The prefix of the threads")
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
    const prefix = interaction.options.getString("prefix").trim();
    if (!prefix) {
      await interaction.reply({
        content: "Prefix must not be empty!",
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
      thread.name.startsWith(prefix)
    );

    let counter = 0;
    const failures: string[] = [];
    for (const thread of filteredThreads.values()) {
      try {
        await thread.delete();
        counter++;
      } catch (error) {
        console.error(`Failed to delete thread ${thread.id}`, error);
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
