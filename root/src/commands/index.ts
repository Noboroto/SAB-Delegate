import * as fs from "fs";
import * as path from "path";

const commandsDir = path.join(__dirname);

const commands = [];

async function loadCommands() {
  const files = fs.readdirSync(commandsDir);
  for (const file of files) {
    if (file == "index.ts") continue;
    if (file.endsWith(".ts")) {
      const command = await import(path.join(commandsDir, file));
      commands.push(command.default);
    }
  }
}

loadCommands();

export default commands;
