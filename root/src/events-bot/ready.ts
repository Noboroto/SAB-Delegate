import { Client, Events, TextChannel } from "discord.js";
import commands from "../commands";
import { happyBirthday } from "../ultils";
import * as fs from "fs";
import scheduler from "node-schedule";

const birthdayTask = async (client: Client) => {
	const keys = await happyBirthday.getServerIDs();
	const wisthesPath = "./files/birthday.json"
	const wishes:String[] = JSON.parse(fs.readFileSync(wisthesPath, "utf8"));
	await happyBirthday.setMaxWishes(wishes.length);
	
	for (const guildId of keys) {
		if (guildId === "max") continue
		const guild = await client.guilds.fetch(guildId);
		const channel = await happyBirthday.getChannel(guildId);
		if (channel === "") {
			console.info(`No birthday channel set for guild ${guild.name}`);
			continue;
		}
		const currMonth = new Date().getMonth() + 1;
		const currDay = new Date().getDate();
		const birthdayUser = await happyBirthday.getDateList(guildId, currMonth, currDay);

		if (birthdayUser.length === 0) {
			console.info(`No birthday for guild ${guild.name}`);
			continue;
		}

		console.log (`Birthday for guild ${guild.name}`);
		const channelObj = await guild.channels.fetch(channel) as TextChannel;
		for (const user of birthdayUser) {
			const msgID = Number(await happyBirthday.getWishID(guildId));
			const msg = wishes[msgID].replaceAll("${name}", `<@${user.discordId}>`);
			await channelObj.send(msg);
		}
	}
}

const birdaySetup = async (client: Client) => {
	const cronRule = "0 0 0 * * *";
	scheduler.scheduleJob(cronRule, async() => {
		console.info("Running birthday task");
		await birthdayTask(client);
	});
}

export default {
	name: Events.ClientReady,
	once: true,
	async execute(args: Client[]) {
		const client = args[0] as Client;
		console.info(`Ready! Logged in as ${client.user?.username}`);
		birdaySetup(client);

		return;
		await client.application.commands
			.set([])
			.then(() =>
				console.info(
					`${client.user?.username} Successfully deleted application command`
				)
			);

		console.info();
		for (const command of commands) {
			await client.application.commands
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
				);
		}

		console.info(
			`${client.user?.username} Successfully registered all application commands`
		);

		await client.destroy();
	},
};
