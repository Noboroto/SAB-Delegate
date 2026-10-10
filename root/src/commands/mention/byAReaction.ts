import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  GuildTextBasedChannel,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { replyInChunks, sendInChunks } from "../_shared/chunkedReply";
import { errorMessage } from "../_shared/errorMessage";
import { fetchReactorIds, hasReaction } from "../_shared/fetchAllReactors";

const commandName = "by-a-reaction";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Mention who reacted to a message")
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
      )

      .addStringOption((Option) =>
        Option.setName("reply-message")
          .setDescription("reply message link")
          .setRequired(false)
      )
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setMaxLength(2000)
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
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
      await interaction.reply({
        content: "Please provide a valid message link",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.options.getString("reply-message") && !needReplyMessage) {
      await interaction.reply({
        content: "Reply message not found!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!hasReaction(messageFromID, reaction)) {
      await interaction.reply({
        content: "No one reacted with that emoji",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Paging through thousands of reactors outlives the 3s reply window. The
    // mentions go to a channel message when replying elsewhere, so the
    // interaction answer is then private.
    await interaction.deferReply(
      needReplyMessage ? { flags: MessageFlags.Ephemeral } : {}
    );

    const reactMemberListID = await fetchReactorIds(messageFromID, reaction);

    if (!reactMemberListID.length) {
      await interaction.editReply("No one reacted with that emoji");
      return;
    }

    let replyMsg = `Reply to ${interaction.user}, there are ${reactMemberListID.length} user(s) who [reacted the message](${messageFromID.url}) with ${reaction}: \n`;
    for (const userID of reactMemberListID) {
      replyMsg += `<@${userID}>`;
      if (userID === interaction.user.id) replyMsg += " (author)";
      replyMsg += ",\n";
    }

    replyMsg += response ? `\n${response}` : "";

    if (!needReplyMessage) {
      await replyInChunks(interaction, replyMsg);
      return;
    }

    try {
      await sendInChunks(
        replyMsg,
        (content) => needReplyMessage.reply(content),
        (content) =>
          (needReplyMessage.channel as GuildTextBasedChannel).send(content)
      );
    } catch (error) {
      console.error("mention by-a-reaction reply failed", error);
      await interaction.editReply(`Cannot reply: ${errorMessage(error)}`);
      return;
    }
    await interaction.editReply("Sent!");
  },
};
