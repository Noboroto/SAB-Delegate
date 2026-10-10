import {
  SlashCommandSubcommandBuilder,
  Role,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  Channel,
  GuildMember,
  ChannelType,
  ThreadChannel,
  TextChannel,
  NewsChannel,
  GuildTextBasedChannel,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { replyInChunks, sendInChunks } from "../_shared/chunkedReply";
import { errorMessage } from "../_shared/errorMessage";
import { fetchReactorIds } from "../_shared/fetchAllReactors";

const commandName = "not-react";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Mention who didn't react to a message")
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setMaxLength(2000)
          .setRequired(false)
      )
      .addRoleOption((Option) =>
        Option.setName("role")
          .setDescription("Role you want to check")
          .setRequired(false)
      )
      .addBooleanOption((Option) =>
        Option.setName("is-reply")
          .setDescription("default is false")
          .setRequired(false)
      )
      .addBooleanOption((Option) =>
        Option.setName("include-bots")
          .setDescription("default is false")
          .setRequired(false)
      )
      .addBooleanOption((Option) =>
        Option.setName("only-in-channel")
          .setDescription("default is true")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const onlyInChannel = interaction.options.getBoolean("only-in-channel");
    const includeBots = interaction.options.getBoolean("include-bots");
    const isReply = interaction.options.getBoolean("is-reply");
    const response = interaction.options.getString("content");

    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    if (!messageFromID) {
      await interaction.reply({
        content: "Please provide a valid message link",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const inputRole = interaction.options.getRole("role") as Role;
    const msgChannel = await interaction.client.channels.fetch(
      (messageFromID.channel as Channel).id
    );

    if (
      msgChannel.type == ChannelType.GuildVoice ||
      msgChannel.type == ChannelType.GuildStageVoice
    ) {
      await interaction.reply({
        content: "This command is not supported in voice channel",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const isTextChannel =
      msgChannel.type == ChannelType.GuildText ||
      msgChannel.type == ChannelType.GuildAnnouncement;
    const isThread =
      msgChannel.type == ChannelType.PublicThread ||
      msgChannel.type == ChannelType.PrivateThread ||
      msgChannel.type == ChannelType.AnnouncementThread;
    if (!isTextChannel && !isThread) {
      await interaction.reply({
        content:
          "This command is not supported in this channel. Type value is " +
          msgChannel.type,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Fetching every member and reactor outlives the 3s reply window. With
    // is-reply the list goes to a channel message, so the answer is private.
    await interaction.deferReply(
      isReply ? { flags: MessageFlags.Ephemeral } : {}
    );

    // Channel and role member lists are built from the cache; fill it first.
    const guildMembers = await interaction.guild.members.fetch();

    let membersChannel: GuildMember[];
    if (isTextChannel) {
      membersChannel = Array.from(
        (msgChannel as TextChannel | NewsChannel).members
          .filter((member) => {
            if (includeBots)
              return member.permissions.has(PermissionFlagsBits.ViewChannel);
            return (
              !member.user.bot &&
              member.permissions.has(PermissionFlagsBits.ViewChannel)
            );
          })
          .values()
      );
    } else {
      const threadMembers = await (msgChannel as ThreadChannel).members.fetch({
        withMember: true,
      });
      membersChannel = threadMembers
        .filter((member) => {
          if (includeBots) return true;
          return !member.user.bot;
        })
        .map((member) => guildMembers.get(member.id))
        .filter((member): member is GuildMember => member !== undefined);
    }
    if (inputRole) {
      if (onlyInChannel === false) {
        membersChannel = Array.from(
          guildMembers
            .filter((member) => member.roles.cache.has(inputRole.id))
            .values()
        );
      } else {
        membersChannel = membersChannel.filter((member) =>
          member.roles.cache.has(inputRole.id)
        );
      }
    }

    const reactMemberListID = new Set(await fetchReactorIds(messageFromID));
    const absent = membersChannel.filter(
      (member) => !reactMemberListID.has(member.id)
    );

    if (absent.length === 0) {
      await interaction.editReply("Everyone in role reacted to the message");
      return;
    }

    const memberMentions = absent.map(
      (member) =>
        `${member}${member.id === interaction.user.id ? " (author)" : ""}`
    );

    const header = `Reply to ${interaction.user}, there are ${absent.length} user(s) [who didn't reacted at message](${messageFromID.url}) are: \n`;
    const footer = response ? `\n${response}` : "";
    const text =
      header +
      memberMentions.map((mention) => mention + ",\n").join("") +
      footer;

    if (!isReply) {
      await replyInChunks(interaction, text);
      return;
    }

    try {
      await sendInChunks(
        text,
        (content) => messageFromID.reply(content),
        (content) =>
          (messageFromID.channel as GuildTextBasedChannel).send(content)
      );
    } catch (error) {
      console.error("mention not-react reply failed", error);
      await interaction.editReply(`Cannot reply: ${errorMessage(error)}`);
      return;
    }
    await interaction.editReply("Sent!");
  },
};
