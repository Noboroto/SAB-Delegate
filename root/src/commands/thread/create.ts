import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  GuildChannel,
  ForumChannel,
  TextChannel,
} from "discord.js";

const commandName = "create";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Create a thread")
      .addStringOption((Option) =>
        Option.setName("name")
          .setDescription("The name of the threads")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("message")
          .setDescription("The message to send to each member")
          .setRequired(true)
      )
      .addBooleanOption((Option) =>
        Option.setName("is-private")
          .setDescription("Is the thread private? (default: false)")
          .setRequired(false)
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
    await interaction.deferReply();

    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as ForumChannel | TextChannel;
    const name =
      interaction.options
        .getString("name")
        .trimEnd()
        .trimStart()
        .trimEnd()
        .trimStart() ?? "unknown";

    const msg = `<@${interaction.user}> created this thread.\n` +  interaction.options.getString("message");
    const isPrivate =
      (interaction.options.getBoolean("is-private") ?? false) &&
      (targetChannel as GuildChannel).type !== ChannelType.GuildForum;

    const latestThread = await targetChannel.threads.create({
      type: isPrivate ? ChannelType.PrivateThread : ChannelType.PublicThread,
      name: `${name}`,
      autoArchiveDuration: 10080,
      reason: `Create thread by ${interaction.user.username}`,
      message: {
        content: `${msg}`,
      },
    });

    if (targetChannel instanceof TextChannel) {
      await latestThread.send(`${msg}`);
    }

    await interaction.editReply(`Created thread ${latestThread}`);
  },
};
