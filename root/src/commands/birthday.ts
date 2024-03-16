
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import appendList from "./birthday/appendList";
import getList from "./birthday/getList";
import setChannel from "./birthday/setChannel";

export default {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Manage birthday wishes for users.")
		.addSubcommand(appendList.addCommand)
		.addSubcommand(getList.addCommand)
		.addSubcommand(setChannel.addCommand)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
		console.info(`[[${interaction.client.user?.username
			}][Subcommad] ${interaction.user.username} - ${commands}`);
    switch (commands) {
			case setChannel.name:
				setChannel.execute(interaction);
				break;
			case getList.name:
				getList.execute(interaction);
				break;
			case appendList.name:
				appendList.execute(interaction);
				break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
