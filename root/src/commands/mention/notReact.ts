import {
  SlashCommandSubcommandBuilder,
  Role,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  Channel,
	Collection,
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

    const inputRole = interaction.options.getRole("role") as Role;
    const msgChannel = (await interaction.client.channels.fetch(
      (messageFromID.channel as Channel).id
    ));

		let membersChannel: GuildMember[];
		if (msgChannel.type == ChannelType.GuildText)
		{
			membersChannel = Array.from(msgChannel.members.filter((member) => {
				if (includeBots)
					return member.permissions.has(PermissionFlagsBits.ViewChannel);
				return (
					!member.user.bot &&
					member.permissions.has(PermissionFlagsBits.ViewChannel)
				);
			}).values());
		}
		else
		{
			const threadMembers = await (msgChannel as ThreadChannel).members.fetch({
				withMember : true
			});
			membersChannel = threadMembers.filter((member) => {
				if (includeBots)
					return true;
				return (
					!member.user.bot
				);
			}).map((member) => 
			{
				const memberData = interaction.guild.members.cache.get(member.id)
				return memberData;
			});
		}

    if (inputRole) {
      if (onlyInChannel) {
				membersChannel = Array.from((await interaction.guild.members.fetch()).filter(
					(member) => member.roles.cache.has(inputRole.id)
				).values());
      } else {
				membersChannel = membersChannel.filter((member) =>
          member.roles.cache.has(inputRole.id)
        );
      }
    }

    if (!messageFromID) {
      await interaction.editReply({
        content: "Please provide a valid message link",
      });
      return;
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
        ephemeral: true,
      });
      return;
    } else {
      for (const member of absent.values()) {
        replyMsg += `${member}`;
        if (member.id === interaction.user.id) {
          replyMsg += " (author)";
        }
        replyMsg += ",\n";
      }
      replyMsg += response ? `\n${response}` : "";
      if (!isReply) {
        interaction.reply(replyMsg);
        return;
      } else messageFromID.reply(replyMsg);
    }
  },
};
