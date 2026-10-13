-- CreateEnum
CREATE TYPE "ScheduledKind" AS ENUM ('SEND', 'COPY');

-- CreateEnum
CREATE TYPE "ScheduledStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "WishRunStatus" AS ENUM ('SENDING', 'DONE');

-- CreateEnum
CREATE TYPE "ActorSource" AS ENUM ('DISCORD', 'HTTP', 'MCP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ApiKeyMode" AS ENUM ('READ', 'WRITE');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "discordUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL,
    "lastUsedIp" TEXT,
    "lastUsedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppState" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID,
    "source" "ActorSource" NOT NULL,
    "actorDiscordId" TEXT,
    "apiKeyId" UUID,
    "action" TEXT NOT NULL,
    "params" JSONB,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayEntry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "month" SMALLINT NOT NULL,
    "day" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayCompletedDate" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "WishRunStatus" NOT NULL DEFAULT 'SENDING',
    "leaseUntil" TIMESTAMPTZ(3),
    "sentDiscordIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ(3),

    CONSTRAINT "BirthdayCompletedDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayWishUsage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "wishIndex" INTEGER NOT NULL,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayWishUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "introChannelId" TEXT,
    "logChannelId" TEXT,
    "birthdayChannelId" TEXT,
    "activityCategoryId" TEXT,
    "wordChannelId" TEXT,
    "wordMaxWords" INTEGER NOT NULL DEFAULT 1500,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guild" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "discordId" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteEntry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "roleId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NoteEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "ScheduledKind" NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT,
    "sourceChannelId" TEXT,
    "sourceMessageId" TEXT,
    "allowedMentions" JSONB NOT NULL DEFAULT '{"parse": []}',
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ScheduledStatus" NOT NULL DEFAULT 'PENDING',
    "leaseUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "pgBossJobId" UUID,
    "source" "ActorSource" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "apiKeyId" UUID,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordGameState" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "started" BOOLEAN NOT NULL DEFAULT true,
    "lastUserId" TEXT NOT NULL DEFAULT '',
    "lastWord" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WordGameState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordGameUsedWord" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "stateId" UUID NOT NULL,
    "word" TEXT NOT NULL,

    CONSTRAINT "WordGameUsedWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_discordUserId_idx" ON "ApiKey"("discordUserId");

-- CreateIndex
CREATE INDEX "ApiKey_prefix_idx" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "AppState_key_key" ON "AppState"("key");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BirthdayEntry_guildId_month_day_idx" ON "BirthdayEntry"("guildId", "month", "day");

-- CreateIndex
CREATE INDEX "BirthdayEntry_guildId_discordId_idx" ON "BirthdayEntry"("guildId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayEntry_guildId_studentId_key" ON "BirthdayEntry"("guildId", "studentId");

-- CreateIndex
CREATE INDEX "BirthdayCompletedDate_status_leaseUntil_idx" ON "BirthdayCompletedDate"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayCompletedDate_guildId_date_key" ON "BirthdayCompletedDate"("guildId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayWishUsage_guildId_wishIndex_key" ON "BirthdayWishUsage"("guildId", "wishIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Guild_discordId_key" ON "Guild"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteEntry_guildId_roleId_topic_key" ON "NoteEntry"("guildId", "roleId", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMessage_pgBossJobId_key" ON "ScheduledMessage"("pgBossJobId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_guildId_status_runAt_idx" ON "ScheduledMessage"("guildId", "status", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_status_leaseUntil_idx" ON "ScheduledMessage"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ScheduledMessage_apiKeyId_idx" ON "ScheduledMessage"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMessage_guildId_seq_key" ON "ScheduledMessage"("guildId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "WordGameState_guildId_key" ON "WordGameState"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "WordGameUsedWord_stateId_word_key" ON "WordGameUsedWord"("stateId", "word");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayEntry" ADD CONSTRAINT "BirthdayEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayCompletedDate" ADD CONSTRAINT "BirthdayCompletedDate_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayWishUsage" ADD CONSTRAINT "BirthdayWishUsage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildConfig" ADD CONSTRAINT "GuildConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteEntry" ADD CONSTRAINT "NoteEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordGameState" ADD CONSTRAINT "WordGameState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordGameUsedWord" ADD CONSTRAINT "WordGameUsedWord_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "WordGameState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

