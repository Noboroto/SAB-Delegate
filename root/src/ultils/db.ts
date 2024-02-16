import { QuickDB } from "quick.db";
import { readFileSync } from "fs";

const noteDbPath = process.env.NOTE_DB_PATH || "./files/note.sqlite";
const wordDbPath = process.env.WORD_DB_PATH || "./files/word.sqlite";
const dictDbPath = process.env.DICT_DB_PATH || "./files/dict.sqlite";
const dictTemplate = "./files/word-dict.json";

export const noteDb = new QuickDB({ filePath: noteDbPath });
export const wordDb = new QuickDB({ filePath: wordDbPath });
export const dictDb = new QuickDB({ filePath: dictDbPath });

(async () => {
  if (!(await dictDb.get("dict"))) {
    const dictObj = JSON.parse(readFileSync(dictTemplate, "utf-8"));
    await dictDb.set("dict", dictObj);
    console.info("Dictionary initialized");
  }
  await dictDb.init();
  await noteDb.init();
  await wordDb.init();

  console.info("Database initialized");
})();
