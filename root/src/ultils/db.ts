import { QuickDB } from "quick.db";
import { readFileSync } from "fs";

const noteDbPath = process.env.NOTE_DB_PATH || "./files/note.sqlite";
const wordDbPath = process.env.WORD_DB_PATH || "./files/word.sqlite";
const dictDbPath = process.env.DICT_DB_PATH || "./files/dict.sqlite";
const configDbPath = process.env.CONFIG_DB_PATH || "./files/config.sqlite";
const birthdayDbPath =
  process.env.BIRTHDAY_DB_PATH || "./files/birthday.sqlite";

const dictTemplate = "./files/word-dict.json";

export const noteDb = new QuickDB({ filePath: noteDbPath });
export const wordDb = new QuickDB({ filePath: wordDbPath });
export const dictDb = new QuickDB({ filePath: dictDbPath });
export const birthdayDb = new QuickDB({ filePath: birthdayDbPath });
export const configDb = new QuickDB({ filePath: configDbPath });

(async () => {
  if (!(await dictDb.get("dict"))) {
    const dictObj = JSON.parse(readFileSync(dictTemplate, "utf-8"));
    await dictDb.set("dict", dictObj);
    console.info("Dictionary initialized");
  }
  await dictDb.init();
  await noteDb.init();
  await wordDb.init();
  await birthdayDb.init();
  await configDb.init();

  console.info("Database initialized");
})();
