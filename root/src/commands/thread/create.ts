import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  ForumChannel,
  TextChannel,
} from "discord.js";
import { errorMessage } from "../_shared/errorMessage";

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
          .setMaxLength(100)
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("message")
          .setDescription("The message to send to each member")
          .setMaxLength(1900)
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
    const name = interaction.options.getString("name").trim();
    if (!name) {
      await interaction.editReply("Thread name must not be empty!");
      return;
    }

    const msg = `${
      interaction.user
    } created this thread.\n\n${interaction.options.getString("message")}`;
    const isForum = targetChannel.type === ChannelType.GuildForum;
    const isPrivate =
      (interaction.options.getBoolean("is-private") ?? false) && !isForum;

    // Discord only allows private threads in plain text channels.
    if (isPrivate && targetChannel.type !== ChannelType.GuildText) {
      await interaction.editReply(
        "Private threads can only be created in text channels!"
      );
      return;
    }

    try {
      if (isForum) {
        const forum = targetChannel as ForumChannel;
        const latestThread = await forum.threads.create({
          name,
          autoArchiveDuration: 10080,
          reason: `Create thread by ${interaction.user.username}`,
          message: {
            content: msg,
          },
        });
        await interaction.editReply(`Created thread ${latestThread}`);
      } else {
        const textChannel = targetChannel as TextChannel;
        const latestThread = await textChannel.threads.create({
          type: isPrivate
            ? ChannelType.PrivateThread
            : ChannelType.PublicThread,
          name,
          autoArchiveDuration: 10080,
          reason: `Create thread by ${interaction.user.username}`,
        });
        await latestThread.send(msg);
        await interaction.editReply(`Created thread ${latestThread}`);
      }
    } catch (error) {
      console.error("thread create failed", error);
      await interaction.editReply(
        `Cannot create the thread: ${errorMessage(error)}`
      );
    }
  },
};
