import ping from "./ping";
import attandanceByRole from "./attandanceByRole";
import bulkRole from "./bulkAssign";
import mention from "./mention";
import addPoll from "./addPoll";
import get from "./get";
import createActivity from "./createActivity";
import note from "./note";
import word from "./word";
import botMessage from "./botMessage";
import scheduler from "./scheduler";
import privateThread from "./privateThread";
import thread from "./thread";

const commands = [
  ping,
  attandanceByRole,
  addPoll,
  createActivity,
  bulkRole,
  mention,
  note,
  word,
  botMessage,
  scheduler,
  get,
  privateThread,
  thread,
];

export default commands;
