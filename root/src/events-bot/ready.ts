import { Client, Events, PermissionsBitField,  } from "discord.js";
import commands from "../commands";

const addRoleForAdmin = (client: Client, roleName: string) => {
	const role = client.guilds.cache
		.get(process.env.GUILD_ID)
		?.roles.cache.find((role) => role.name === roleName);
	if (!role) {
		console.error(`Role "${roleName}" not found`);
		return;
	}

	// create full permistion bit for role
	const permissions = new PermissionsBitField([
		PermissionsBitField.All,
	]);
	
	// get list of full channels
	const channels = client.guilds.cache
		.get(process.env.GUILD_ID)
		?.channels.cache.filter((channel) => !channel.name.includes("core"));

	// set role permission for all channels
	channels?.forEach((channel) => {
		console.log(`Setting permission for role "${roleName}" in channel "${channel.name}"`);
		channel.permissionsFor(role)?.add(permissions);
	});
}

export default {
	name: Events.ClientReady,
	once: true,
	async execute(args: Client[]) {
		const client = args[0] as Client;
		console.log(`Ready! Logged in as ${client.user?.tag}`);

		addRoleForAdmin(client, "Technician");
		return;
		await client.application.commands
			.set([])
			.then(() =>
				console.log("Successfully deleted application command")
			);

		console.log();
		for (const command of commands) {
			client.application.commands
				.create(command.data)
				.then(() =>
					console.log(
						`Successfully registered application command "${command.data.name}"`
					)
				)
				.catch((error) =>
					console.error(
						`Error registering application command "${command.data.name}"\n${error}`
					)
				);
		}
	},
};
