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
			.addIntegerOption((Option) =>
				Option.setName("month")
					.setDescription("birthday in a specific month")
					.setMinValue(1)
					.setMaxValue(12)
					.setRequired(false)
			)
	},
	async execute(interaction: ChatInputCommandInteraction) {
		const month = interaction.options.getInteger("month") ?? 0;
		await interaction.reply("Getting list of users in the birthday list");
		const guid = interaction.guildId;

		const limit = 1500;

		for (let m = 1; m <= 12; m++) {
			if (month !== 0 && month !== m) 
				continue;
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
						msg += "###" + monthListArr[++idx];
					}
					await interaction.followUp(msg);
				}
			}
		}

		await interaction.followUp("Done!");
	},
};
