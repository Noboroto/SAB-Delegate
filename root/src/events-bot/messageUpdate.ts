import { Events, Message } from "discord.js";
import fs from "fs";

const dictionaryPath = "./files/reactionsDict.json";
const reactionsDict = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));

export default {
	name: Events.MessageUpdate,
	once: false,
	async execute(args: Message[]) {
		const message = args[1] as Message;

		for (const key in reactionsDict) {
			if (message.content.toLowerCase().includes(key)) {
				message.react(reactionsDict[key]);
			}
		}
	},
};
