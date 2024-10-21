import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

const commandName = "id-by-reaction";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Get ids who reacted to a message")
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
      )
      .addBooleanOption((Option) =>
        Option.setName("mention")
          .setDescription("mention users or not, default is false")
          .setRequired(false)
      )
      .addStringOption((Option) =>
        Option.setName("reply-message")
          .setDescription("reply message link")
          .setRequired(false)
      )
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const needMention = interaction.options.getBoolean("mention") ?? false;
    const response = interaction.options.getString("content");
    const reaction = interaction.options.getString("emoji")?.trim() ?? "";
    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    const needReplyMessage = await getMessageFromOption(
      interaction,
      "reply-message"
    );

    if (!messageFromID) {
      await interaction.editReply({
        content: "Please provide a valid message link",
      });
      return;
    }

    const reactMemberListID: string[] = [];
    const reactionList = await messageFromID.reactions.cache;

    for (const reactionFromMessage of reactionList.values()) {
      if (reactionFromMessage.emoji.toString() !== reaction) continue;
      await reactionFromMessage.users.fetch().then((users) => {
        users.forEach((user) => {
          if (user.bot) return;
          reactMemberListID.push(user.id);
        });
      });
    }

		const msgUrl = `https://discord.com/channels/${messageFromID.guild.id}/${messageFromID.channel.id}/${messageFromID.id}`;

		let replyMsg = `There are ${reactMemberListID.length} user(s) who [reacted the message](${msgUrl}) with ${reaction}: \n`;
    for (const userID of reactMemberListID) {
      if (needMention) {
        replyMsg += `<@${userID}>`;
        if (userID === interaction.user.id) replyMsg += " (author)";
      } else {
        replyMsg += `${userID}`;
      }
      replyMsg += ",\n";
    }

    replyMsg += response ? `\n${response}` : "";

    if (!reactMemberListID.length) {
      interaction.reply({
        content: "No one reacted with that emoji",
        ephemeral: true,
      });
      return;
    }

    if (needReplyMessage) {
      needReplyMessage.reply(replyMsg);
      return;
    } else interaction.reply(replyMsg);
  },
};
