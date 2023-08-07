import ping from "./ping";
import sendMessage from "./sendMessage";
import copyToChannel from "./copyToChannel";
import editBotMessage from "./editBotMessage";
import bulkRole from "./bulkRole";
import reactMessaage from "./reactMessaage";
import addNoteByRole from "./addNoteByRole";
import removeNoteByRole from "./removeNoteByRole";
import getNoteByRole from "./getNoteByRole";
import attandanceByRole from "./attandanceByRole";
import addPoll from "./addPoll";

const commands = [
	ping,
	sendMessage,
	copyToChannel,
	editBotMessage,
	bulkRole,
	reactMessaage,
	addNoteByRole,
	removeNoteByRole,
	getNoteByRole,
	attandanceByRole,
	addPoll,
];

export default commands;
