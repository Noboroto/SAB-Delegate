import ping from './ping';
import sendMessage from './sendMessage';
import copyToChannel from './copyToChannel';
import editBotMessage from './editBotMessage';
import bulkRole from './bulkRole';
import reactMessaage from './reactMessaage';
import noteByRole from './noteByRole';
import getNoteByRole from './getNoteByRole';

const commands = [
    ping,
    sendMessage,
    copyToChannel,
    editBotMessage,
    bulkRole,
    reactMessaage,
    noteByRole,
    getNoteByRole
];

export default commands;