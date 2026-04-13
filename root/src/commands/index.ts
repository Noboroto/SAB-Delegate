import * as fs from "fs";
import * as path from "path";

const commandsDir = path.join(__dirname);

const commands = [];

const files = fs.readdirSync(commandsDir);
for (const file of files) {
  if (file == "index.ts" || file == "index.js") continue;
  if (file.endsWith(".ts") || file.endsWith(".js")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const command = require(path.join(commandsDir, file));
    commands.push(command.default ?? command);
  }
}

export default commands;
