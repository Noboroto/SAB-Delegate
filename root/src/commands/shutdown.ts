import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("shutdown")
		.setDescription("Shutdown the bot")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
		
  async execute(interaction: ChatInputCommandInteraction) {
		const botName = interaction.client.user?.username;
		const author = interaction.user.username;
		await interaction.reply(`I am being shut down by ${author}...`);
		interaction.client.destroy();
		console.log(`${botName} is shutting down by ${author}...`);
  },
};
