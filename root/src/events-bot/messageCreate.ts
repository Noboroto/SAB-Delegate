import { Events, Message } from "discord.js";
import fs from "fs";

const dictionaryPath = "./config/reactionsDict.json";
const reactionsDict = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));

export default {
	name: Events.MessageCreate,
	once: false,
	async execute(args: any) {
		const message = args[0] as Message;

        for (const key in reactionsDict) {
            if (message.content.toLowerCase().includes(key)) {
                message.react(reactionsDict[key]);
            }
        }
	},
};
