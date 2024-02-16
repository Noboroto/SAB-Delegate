import ping from "./ping";
import attandanceByRole from "./attandanceByRole";
import bulkRole from "./bulkRole";
import mention from "./mention";
import addPoll from "./addPoll";
import getIntroduction from "./getInfo";
import createActivity from "./createActivity";
import note from "./note";
import word from "./word";
import botMessage from "./botMessage";
import scheduler from "./scheduler";

const commands = [
	ping,
	attandanceByRole,
	addPoll,
	getIntroduction,
	createActivity,
	bulkRole,
	mention,	
	note,
	word,
	botMessage,
	scheduler
];

export default commands;
