import {
  SlashCommandSubcommandBuilder,
  TextChannel,
  ChatInputCommandInteraction,
  FetchMessagesOptions,
	Collection,
	Message,
} from "discord.js";
import { configManager } from "../../ultils";

const lots_of_messages_getter = async (channel: TextChannel, limit_msg = 1000) => {
	let sum_messages: Collection<string, Message<true>>[] = [];
  let last_id = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let options: FetchMessagesOptions = { 
			limit: 100, 
			cache: false 
		};
    if (last_id) {
      options.before = last_id;
    }

    const messages = await channel.messages.fetch(options);
		sum_messages = sum_messages.concat([messages]);
    last_id = messages.last().id;

		if (messages.size != 100 || sum_messages.length >= limit_msg) {
      break;
    }
  }

  return sum_messages;
};

const commandName = "intro";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "get first introduction of a user in intro channels (set by admin)"
      )

      .addUserOption((Option) =>
        Option.setName("user")
          .setDescription("user to get introduction")
          .setRequired(true)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
		const channelID = await configManager.getIntroChannelId(interaction.guildId);
		if (!channelID) {
			await interaction.reply({
				content: "No introduction channel set",
				ephemeral: true,
			});
			return;
		}
		
    const srcChannel = (await interaction.client.channels.fetch(
      channelID
    )) as TextChannel;
    const user = interaction.options.getUser("user");
    const messageCollections = await lots_of_messages_getter(srcChannel);

    let message:Message<true> = null;
    for (const messages of messageCollections.reverse()) {
			const tempMessage = messages
				.reverse()
				.find((msg) => msg.author.id === user.id);
			if (tempMessage) {
				message = tempMessage;
				break;
			}
		}

    if (!message) {
      await interaction.reply({
        content: "User has no introduction",
        ephemeral: true,
      });
      return;
    }

    const messageContent = message.content;
		const messageUrl = message.url;
    const replyMessage = {
			content: `Jump to message ${user}'s [introduction](${messageUrl}):\n\n${messageContent}`,
    };
    await interaction.reply(replyMessage);
  },
};
