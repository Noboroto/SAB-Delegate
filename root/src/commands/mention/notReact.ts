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
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

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
      interaction.reply({
        content: "Please provide a valid message link",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const inputRole = interaction.options.getRole("role") as Role;
    const msgChannel = await interaction.client.channels.fetch(
      (messageFromID.channel as Channel).id
    );

    console.log(msgChannel.type);

    let membersChannel: GuildMember[];
    if (
      msgChannel.type == ChannelType.GuildText ||
      msgChannel.type == ChannelType.GuildAnnouncement
    ) {
      membersChannel = Array.from(
        msgChannel.members
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
    } else if (
      msgChannel.type == ChannelType.PublicThread ||
      msgChannel.type == ChannelType.PrivateThread ||
      msgChannel.type == ChannelType.AnnouncementThread
    ) {
      const threadMembers = await (msgChannel as ThreadChannel).members.fetch({
        withMember: true,
      });
      membersChannel = threadMembers
        .filter((member) => {
          if (includeBots) return true;
          return !member.user.bot;
        })
        .map((member) => {
          return interaction.guild.members.cache.get(member.id);
        })
        .filter((member): member is GuildMember => member !== undefined);
    } else if (
      msgChannel.type == ChannelType.GuildVoice ||
      msgChannel.type == ChannelType.GuildStageVoice
    ) {
      interaction.reply({
        content: "This command is not supported in voice channel",
        flags: MessageFlags.Ephemeral,
      });
      return;
    } else {
      interaction.reply({
        content:
          "This command is not supported in this channel. Type value is " +
          msgChannel.type,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (inputRole) {
      if (onlyInChannel === false) {
        membersChannel = Array.from(
          (await interaction.guild.members.fetch())
            .filter((member) => member.roles.cache.has(inputRole.id))
            .values()
        );
      } else {
        membersChannel = membersChannel.filter((member) =>
          member.roles.cache.has(inputRole.id)
        );
      }
    }

    const reactMemberListID: string[] = [];
    const reactionList = await messageFromID.reactions.cache;

    for (const reactionFromMessage of reactionList.values()) {
      await reactionFromMessage.users.fetch().then((users) => {
        users.forEach((user) => {
          if (user.bot) return;
          reactMemberListID.push(user.id);
        });
      });
    }

    const absent = membersChannel.filter((member) => {
      try {
        return !reactMemberListID.includes(member.id);
      } catch (error) {
        console.error(error);
        return true;
      }
    });

    const msgUrl = `https://discord.com/channels/${interaction.guild.id}/${messageFromID.channel.id}/${messageFromID.id}`;

    let replyMsg = `Reply to ${interaction.user}, there are ${absent.length} user(s) [who didn't reacted at message](${msgUrl}) are: \n`;

    if (absent.length === 0) {
      interaction.reply({
        content: "Everyone in role reacted to the message",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memberMentions: string[] = [];
    for (const member of absent.values()) {
      let mention = `${member}`;
      if (member.id === interaction.user.id) mention += " (author)";
      memberMentions.push(mention);
    }

    const header = `Reply to ${interaction.user}, there are ${absent.length} user(s) [who didn't reacted at message](${msgUrl}) are: \n`;
    const footer = response ? `\n${response}` : "";

    const chunks: string[] = [];
    let current = header;
    for (let i = 0; i < memberMentions.length; i++) {
      const line = memberMentions[i] + ",\n";
      const isLast = i === memberMentions.length - 1;
      const suffix = isLast ? footer : "";
      if ((current + line + suffix).length > 2000) {
        chunks.push(current);
        current = line;
      } else {
        current += line;
      }
      if (isLast) current += footer;
    }
    chunks.push(current);

    if (!isReply) {
      await interaction.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    } else {
      await messageFromID.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await messageFromID.channel.send(chunks[i]);
      }
    }
  },
};
