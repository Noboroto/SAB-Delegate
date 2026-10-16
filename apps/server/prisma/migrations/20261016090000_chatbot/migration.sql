-- CreateTable
CREATE TABLE "ChatbotConfig" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultMonthlyLimit" INTEGER NOT NULL DEFAULT 100000,
    "llmBaseUrl" TEXT,
    "llmModel" TEXT,
    "llmApiKeyEnc" TEXT,
    "llmKeyLast4" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatbotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotChannel" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotChannelMemory" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "channelId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatbotChannelMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotUserMemory" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "turnsSinceSummary" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatbotUserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotUserQuota" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyLimit" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatbotUserQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotUsage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatbotUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotConfig_guildId_key" ON "ChatbotConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotChannel_channelId_key" ON "ChatbotChannel"("channelId");

-- CreateIndex
CREATE INDEX "ChatbotChannel_guildId_idx" ON "ChatbotChannel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotChannelMemory_guildId_channelId_key" ON "ChatbotChannelMemory"("guildId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotUserMemory_guildId_userId_key" ON "ChatbotUserMemory"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotUserQuota_guildId_userId_key" ON "ChatbotUserQuota"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ChatbotUsage_guildId_period_idx" ON "ChatbotUsage"("guildId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotUsage_guildId_userId_period_key" ON "ChatbotUsage"("guildId", "userId", "period");

-- AddForeignKey
ALTER TABLE "ChatbotConfig" ADD CONSTRAINT "ChatbotConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotChannel" ADD CONSTRAINT "ChatbotChannel_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotChannelMemory" ADD CONSTRAINT "ChatbotChannelMemory_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotUserMemory" ADD CONSTRAINT "ChatbotUserMemory_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotUserQuota" ADD CONSTRAINT "ChatbotUserQuota_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotUsage" ADD CONSTRAINT "ChatbotUsage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Constraints Prisma cannot express; documented with `///` on the models.
ALTER TABLE "ChatbotConfig"
  ADD CONSTRAINT "ChatbotConfig_limit_check" CHECK ("defaultMonthlyLimit" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "ChatbotConfig_llm_override_check" CHECK (
    -- num_nonnulls, not per-column comparisons: a comparison on a NULL column
    -- yields NULL, and a CHECK that yields NULL passes.
    num_nonnulls("llmBaseUrl", "llmModel", "llmApiKeyEnc", "llmKeyLast4") = 0
    OR (
      num_nonnulls("llmBaseUrl", "llmModel", "llmApiKeyEnc", "llmKeyLast4") = 4
      AND "llmBaseUrl" LIKE 'https://_%' AND "llmModel" <> '' AND "llmApiKeyEnc" <> ''
      AND char_length("llmKeyLast4") BETWEEN 1 AND 4
    )
  );

ALTER TABLE "ChatbotChannel"
  ADD CONSTRAINT "ChatbotChannel_channelId_check" CHECK ("channelId" ~ '^[0-9]{17,20}$');

ALTER TABLE "ChatbotChannelMemory"
  ADD CONSTRAINT "ChatbotChannelMemory_channelId_check" CHECK ("channelId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "ChatbotChannelMemory_summary_check" CHECK (char_length("summary") <= 2000);

ALTER TABLE "ChatbotUserMemory"
  ADD CONSTRAINT "ChatbotUserMemory_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "ChatbotUserMemory_summary_check" CHECK (char_length("summary") <= 2000),
  ADD CONSTRAINT "ChatbotUserMemory_turns_check" CHECK ("turnsSinceSummary" >= 0);

ALTER TABLE "ChatbotUserQuota"
  ADD CONSTRAINT "ChatbotUserQuota_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "ChatbotUserQuota_limit_check" CHECK ("monthlyLimit" BETWEEN 0 AND 1000000000);

ALTER TABLE "ChatbotUsage"
  ADD CONSTRAINT "ChatbotUsage_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "ChatbotUsage_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "ChatbotUsage_amounts_check" CHECK (
    "used" BETWEEN 0 AND 1000000000 AND "bonus" BETWEEN 0 AND 1000000000
  );
