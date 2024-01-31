import ping from "./ping";
import sendMessage from "./sendMessage";
import copyToChannel from "./copyToChannel";
import editBotMessage from "./editBotMessage";
import bulkRole from "./bulkRole";
import reactMessaage from "./reactMessaage";
import attandanceByRole from "./attandanceByRole";
import addPoll from "./addPoll";
import getIntroduction from "./getInfo";
import createActivity from "./createActivity";
import mentionReactions from "./mentionReactions";
import notReact from "./mentionNoReact";
import note from "./note";

const commands = [
	ping,
	sendMessage,
	copyToChannel,
	editBotMessage,
	bulkRole,
	reactMessaage,
	attandanceByRole,
	addPoll,
	getIntroduction,
	createActivity,
	mentionReactions,
	notReact,
	note,
];

export default commands;
