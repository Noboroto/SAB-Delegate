import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
} from "discord.js";

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
    const oldPrefix =
      interaction.options.getString("old-prefix").trimEnd().trimStart() ??
      "unknown";
    const newPrefix =
      interaction.options.getString("new-prefix").trimEnd().trimStart() ??
      "unknown";
    let counter = 0;
    await interaction.deferReply({ ephemeral: true });

    //get all threads by prefix
    const threads = await targetChannel.threads.fetch();
    const filteredThreads = threads.threads.filter((thread) =>
      thread.name.startsWith(oldPrefix)
    );

    //delete all threads
    for (const thread of filteredThreads.values()) {
      const newName = thread.name.replace(oldPrefix, newPrefix);
      await thread.setName(newName);
      counter++;
    }

    const message = {
      content: `Done ${counter} thread(s)!`,
    };

    await interaction.editReply(message);
  },
};
