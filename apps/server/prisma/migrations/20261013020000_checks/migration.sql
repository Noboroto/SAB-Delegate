-- Constraints Prisma cannot express. Each one is documented with `///` on its
-- model in prisma/schema. Column names are the quoted camelCase Prisma emits.

-- Prisma leaves list columns nullable; a NULL list would read as "no list".
ALTER TABLE "BirthdayCompletedDate" ALTER COLUMN "sentDiscordIds" SET NOT NULL;

ALTER TABLE "Guild"
  ADD CONSTRAINT "Guild_locale_check" CHECK ("locale" IN ('vi', 'en'));

-- A channel/category column is NULL or a Discord snowflake (17-20 digits).
ALTER TABLE "GuildConfig"
  ADD CONSTRAINT "GuildConfig_wordMaxWords_check" CHECK ("wordMaxWords" >= 200),
  ADD CONSTRAINT "GuildConfig_snowflakes_check" CHECK (
    ("introChannelId" IS NULL OR "introChannelId" ~ '^[0-9]{17,20}$')
    AND ("logChannelId" IS NULL OR "logChannelId" ~ '^[0-9]{17,20}$')
    AND ("birthdayChannelId" IS NULL OR "birthdayChannelId" ~ '^[0-9]{17,20}$')
    AND ("activityCategoryId" IS NULL OR "activityCategoryId" ~ '^[0-9]{17,20}$')
    AND ("wordChannelId" IS NULL OR "wordChannelId" ~ '^[0-9]{17,20}$')
  );

-- (month, day) must be a real calendar day. February allows 29: someone born on
-- it is greeted on the days the year has it.
ALTER TABLE "BirthdayEntry"
  ADD CONSTRAINT "BirthdayEntry_month_day_check" CHECK (
    "month" BETWEEN 1 AND 12
    AND "day" BETWEEN 1 AND 31
    AND "day" <= CASE "month"
      WHEN 2 THEN 29
      WHEN 4 THEN 30
      WHEN 6 THEN 30
      WHEN 9 THEN 30
      WHEN 11 THEN 30
      ELSE 31
    END
  );

-- A claimed run must carry a lease, or a crashed run could never be reclaimed.
ALTER TABLE "BirthdayCompletedDate"
  ADD CONSTRAINT "BirthdayCompletedDate_lease_check" CHECK (
    "status" <> 'SENDING' OR "leaseUntil" IS NOT NULL
  );

ALTER TABLE "BirthdayWishUsage"
  ADD CONSTRAINT "BirthdayWishUsage_wishIndex_check" CHECK ("wishIndex" >= 0);

ALTER TABLE "NoteEntry"
  ADD CONSTRAINT "NoteEntry_topic_check" CHECK ("topic" <> ''),
  ADD CONSTRAINT "NoteEntry_content_check" CHECK ("content" <> '');

ALTER TABLE "WordGameState"
  ADD CONSTRAINT "WordGameState_count_check" CHECK ("count" >= 0);

ALTER TABLE "WordGameUsedWord"
  ADD CONSTRAINT "WordGameUsedWord_word_check" CHECK ("word" <> '' AND "word" = lower("word"));

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_seq_check" CHECK ("seq" > 0),
  ADD CONSTRAINT "ScheduledMessage_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "ScheduledMessage_kind_check" CHECK (
    ("kind" <> 'SEND' OR ("content" IS NOT NULL AND "sourceChannelId" IS NULL AND "sourceMessageId" IS NULL))
    AND ("kind" <> 'COPY' OR ("sourceChannelId" IS NOT NULL AND "sourceMessageId" IS NOT NULL))
  ),
  ADD CONSTRAINT "ScheduledMessage_lease_check" CHECK (
    "status" <> 'SENDING' OR "leaseUntil" IS NOT NULL
  );

-- A WRITE key must expire, and within 30 days. The explicit NOT NULL matters: a
-- NULL expiresAt makes the comparison NULL, which a CHECK treats as passing.
ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_prefix_check" CHECK (char_length("prefix") = 8),
  ADD CONSTRAINT "ApiKey_write_expiry_check" CHECK (
    "mode" = 'READ'
    OR ("expiresAt" IS NOT NULL AND "expiresAt" <= "createdAt" + interval '30 days')
  );

ALTER TABLE "AppState"
  ADD CONSTRAINT "AppState_key_check" CHECK ("key" <> '');
