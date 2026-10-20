ALTER TABLE "GuildConfig" ALTER COLUMN "wordMaxWords" SET DEFAULT 3000;

-- 1500 was the untouched old default; a server that never chose a limit follows the new one.
UPDATE "GuildConfig" SET "wordMaxWords" = 3000 WHERE "wordMaxWords" = 1500;
