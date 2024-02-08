import ping from "./ping";
import bulkRole from "./bulkRole";
import attandanceByRole from "./attandanceByRole";
import addPoll from "./addPoll";
import getIntroduction from "./getInfo";
import createActivity from "./createActivity";
import mentionReactions from "./mentionReactions";
import notReact from "./mentionNoReact";
import note from "./note";
import word from "./word";
import botMessage from "./bot-message";

const commands = [
	ping,
	bulkRole,
	attandanceByRole,
	addPoll,
	getIntroduction,
	createActivity,
	mentionReactions,
	notReact,
	note,
	word,
	botMessage
];

export default commands;
