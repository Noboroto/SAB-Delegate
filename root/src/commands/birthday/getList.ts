import {
	ChatInputCommandInteraction,
	SlashCommandSubcommandBuilder,
} from "discord.js";

import { happyBirthday } from "../../ultils";

const commandName = "get-list";

export default {
	name: commandName,
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName(commandName)
			.setDescription("Get a list of users in the birthday list")
	},
	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply("Getting list of users in the birthday list");
		const guid = interaction.guildId;

		const limit = 1500;

		for (let m = 1; m <= 12; m++) {
			const monthList = await happyBirthday.getMonthList(guid, m);
			if (monthList === "No birthdays found") {
				continue;
			}
			if (monthList.length <= limit) {
				await interaction.followUp(`## Month ${m}:\n ${monthList}`);
			}
			else {
				const monthListArr = monthList.split("###");
				for (let idx = 0; idx < monthListArr.length; idx++) {
					let msg = `## Month ${m} - partial\n###` + monthListArr[idx];
					while (msg.length < limit) {
						idx++;
						msg += "###" + monthListArr[idx];
					}
					await interaction.followUp(msg);
				}
			}
		}

		await interaction.followUp("Done!");
	},
};
