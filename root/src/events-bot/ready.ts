import { Client, Events, TextChannel } from "discord.js";
import commands from "../commands";
import { happyBirthday } from "../ultils";
import * as fs from "fs";
import scheduler from "node-schedule";

const birthdayTask = async (client: Client) => {
	const keys = await happyBirthday.getServerIDs();
	const wisthesPath = "./constants/birthday.json";
	const wishes: string[] = JSON.parse(fs.readFileSync(wisthesPath, "utf8"));
	await happyBirthday.setMaxWishes(wishes.length);

	for (const guildId of keys) {
		if (guildId == "max") continue;
		await client.guilds
			.fetch(guildId)
			.then(async (guild) => {
				const channel = await happyBirthday.getChannel(guildId);
				if (channel === "") {
					console.info(`No birthday channel set for guild ${guild.name}`);
					return;
				}
				const currMonth = new Date().getMonth() + 1;
				const currDay = new Date().getDate();
				const currYear = new Date().getFullYear();

				console.log(`Current date: ${currDay}/${currMonth}/${currYear}`);
				const isComplete = await happyBirthday.getIsCompleteDate(
					guildId,
					currMonth,
					currDay
				);

				if (isComplete) {
					console.info(`Birthday for guild ${guild.name} is already complete`);
					return;
				}

				const birthdayUser = await happyBirthday.getDateList(
					guildId,
					currMonth,
					currDay
				);

				if (birthdayUser.length === 0) {
					console.info(`No birthday for guild ${guild.name}`);
					return;
				}

				console.log(`Birthday for guild ${guild.name}`);
				const channelObj = (await guild.channels.fetch(channel)) as TextChannel;
				console.info(`Today has total ${birthdayUser.length} birthday user`);
				console.info(`Send to channel ${channelObj.name}`);
				for (const user of birthdayUser) {
					const msgID = Number(await happyBirthday.getWishID(guildId));
					const msg = wishes[msgID].replaceAll(
						"${name}",
						`<@${user.discordId}>`
					);
					console.info(`Send wish to ${user.name} with id ${user.discordId}`);
					await channelObj.send(msg);
				}
				await happyBirthday.setIsCompleteDate(
					guildId,
					currMonth,
					currDay,
					true
				);
			})
			.catch((error) => {
				console.error(`Error fetching guild ${guildId}\n${error}`);
			});
	}
};

const birthdaySetup = async (client: Client) => {
	const cronRule = "0 0 0 * * *";
	scheduler.scheduleJob(cronRule, async () => {
		console.info(`${client.user?.username} Running birthday task`);
		await birthdayTask(client);
	});
};

export default {
	name: Events.ClientReady,
	once: true,
	async execute(args: Client[]) {
		const client = args[0];
		console.info(`Ready! Logged in as ${client.user?.username}`);
		birthdaySetup(client);
		await birthdayTask(client);

		if (!process.env.CREATE_CMD || process.env.CREATE_CMD == "0") {
			console.info("Production Mode");
			return;
		}
		await client.application.commands
			.set([])
			.then(() =>
				console.info(
					`${client.user?.username} Successfully deleted application command`
				)
			);

		console.info();
		const registeredCommands = [];
		for (const command of commands) {
			registeredCommands.push(
				client.application.commands
					.create(command.data)
					.then(() =>
						console.info(
							`${client.user?.username} Successfully registered application command "${command.data.name}"`
						)
					)
					.catch((error) =>
						console.error(
							`${client.user?.username} Error registering application command "${command.data.name}"\n${error}`
						)
					)
			);
		}

		await Promise.all(registeredCommands)
			.then(() => {
				console.info(
					`${client.user?.username} Successfully registered all application commands`
				);
			})
			.catch((error) =>
				console.error(
					`${client.user?.username} Error registering application commands\n${error}`
				)
			)
			.then(() => client.destroy());
	},
};
