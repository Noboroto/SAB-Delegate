import {
  SlashCommandSubcommandBuilder,
  TextChannel,
  ChatInputCommandInteraction,
  Message,
  Collection,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

const FETCH_LIMIT = 100;
const commandName = "any";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Purge messages in this channel. Default is the latest messages."
      )
      .addStringOption((Option) =>
        Option.setName("until-link")
          .setDescription("stop purging at (not included)")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("from-link")
          .setDescription("start purging at (will be included)")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const thisChannel = interaction.channel as TextChannel | null;
    if (!thisChannel) {
      await interaction.editReply({
        content: "Cannot purge: this channel is not available",
      });
      return;
    }

    let fromMessage = await getMessageFromOption(interaction, "from-link");
    const untilMessage = await getMessageFromOption(interaction, "until-link");

    if (!untilMessage) {
      await interaction.editReply({
        content: "Invalid until message",
      });
      return;
    }

    if (interaction.options.getString("from-link") && !fromMessage) {
      await interaction.editReply({
        content: "Invalid from message",
      });
      return;
    }

    // Deleting is destructive and the links are user input: only touch this channel.
    if (untilMessage.channelId !== interaction.channelId) {
      await interaction.editReply({
        content: "Messages must be in the channel where you run this command",
      });
      return;
    }
    if (fromMessage && fromMessage.channelId !== interaction.channelId) {
      await interaction.editReply({
        content: "Messages must be in the channel where you run this command",
      });
      return;
    }

    if (!fromMessage) {
      fromMessage = (
        await thisChannel.messages.fetch({ cache: true, limit: 1 })
      ).first();
    }
    if (!fromMessage) {
      await interaction.editReply({ content: "No message to purge" });
      return;
    }

    if (untilMessage.createdTimestamp >= fromMessage.createdTimestamp) {
      await interaction.editReply({
        content: "The until message must be older than the from message",
      });
      return;
    }

    const initMsg = fromMessage;
    let deleteMessages: Collection<string, Message> = new Collection();
    let cursor = initMsg;
    do {
      const batch = (
        await thisChannel.messages.fetch({
          cache: false,
          limit: FETCH_LIMIT,
          before: cursor.id,
        })
      ).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      if (batch.size === 0) break;
      deleteMessages = deleteMessages.concat(batch);
      // Ascending order: the oldest message of the batch is the next page's cursor.
      cursor = batch.first();
      if (
        batch.has(untilMessage.id) ||
        cursor.createdTimestamp <= untilMessage.createdTimestamp ||
        batch.size < FETCH_LIMIT
      ) {
        break;
      }
      // eslint-disable-next-line no-constant-condition -- exits via the break conditions above
    } while (true);
    deleteMessages.set(initMsg.id, initMsg);
    deleteMessages = deleteMessages.filter((msg) => {
      return (
        untilMessage.createdTimestamp < msg.createdTimestamp &&
        msg.createdTimestamp <= initMsg.createdTimestamp &&
        !msg.system
      );
    });

    const results = await Promise.all(
      deleteMessages.map((msg) =>
        thisChannel.messages
          .delete(msg.id)
          .then(() => true)
          .catch((e) => {
            console.error(`Failed to delete message ${msg.id}`, e);
            return false;
          })
      )
    );
    const deleted = results.filter(Boolean).length;
    await interaction.editReply({
      content:
        `Deleted ${deleted} messages.` +
        (deleted < deleteMessages.size
          ? ` Failed to delete ${deleteMessages.size - deleted}.`
          : ""),
    });
  },
};
