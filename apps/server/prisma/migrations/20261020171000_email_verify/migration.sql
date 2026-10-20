-- CreateEnum
CREATE TYPE "EmailVerifyMethod" AS ENUM ('CODE', 'MANUAL');

-- CreateTable
CREATE TABLE "EmailVerifyConfig" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unverifiedRoleId" TEXT,
    "logChannelId" TEXT,
    "verifyMessage" TEXT,
    "autoVerifyOnJoin" BOOLEAN NOT NULL DEFAULT false,
    "autoUnverifiedOnJoin" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailVerifyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberJoinInvite" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberJoinInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailBlockPattern" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "pattern" TEXT NOT NULL,

    CONSTRAINT "EmailBlockPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailList" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailListEntry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "listId" UUID NOT NULL,
    "emailHash" TEXT NOT NULL,

    CONSTRAINT "EmailListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "method" "EmailVerifyMethod" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerifyPending" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerifyPending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSendDay" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmailSendDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSendThrottle" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailSendThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpConfig" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SmtpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerifyConfig_guildId_key" ON "EmailVerifyConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRule_guildId_position_key" ON "AccessRule"("guildId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MemberJoinInvite_guildId_userId_key" ON "MemberJoinInvite"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailBlockPattern_guildId_pattern_key" ON "EmailBlockPattern"("guildId", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "EmailList_guildId_name_key" ON "EmailList"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailListEntry_listId_emailHash_key" ON "EmailListEntry"("listId", "emailHash");

-- CreateIndex
CREATE INDEX "EmailVerification_guildId_verifiedAt_idx" ON "EmailVerification"("guildId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_guildId_userId_key" ON "EmailVerification"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_guildId_emailHash_key" ON "EmailVerification"("guildId", "emailHash");

-- CreateIndex
CREATE INDEX "EmailVerifyPending_expiresAt_idx" ON "EmailVerifyPending"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerifyPending_guildId_userId_key" ON "EmailVerifyPending"("guildId", "userId");

-- CreateIndex
CREATE INDEX "EmailSendDay_day_idx" ON "EmailSendDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendDay_guildId_day_key" ON "EmailSendDay"("guildId", "day");

-- CreateIndex
CREATE INDEX "EmailSendThrottle_day_idx" ON "EmailSendThrottle"("day");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendThrottle_guildId_userId_key" ON "EmailSendThrottle"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SmtpConfig_singleton_key" ON "SmtpConfig"("singleton");

-- AddForeignKey
ALTER TABLE "EmailVerifyConfig" ADD CONSTRAINT "EmailVerifyConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRule" ADD CONSTRAINT "AccessRule_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberJoinInvite" ADD CONSTRAINT "MemberJoinInvite_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBlockPattern" ADD CONSTRAINT "EmailBlockPattern_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailList" ADD CONSTRAINT "EmailList_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailListEntry" ADD CONSTRAINT "EmailListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "EmailList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerifyPending" ADD CONSTRAINT "EmailVerifyPending_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSendDay" ADD CONSTRAINT "EmailSendDay_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSendThrottle" ADD CONSTRAINT "EmailSendThrottle_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraints Prisma cannot express; documented with `///` on the models.
-- Where a column may be NULL the CHECK says IS NOT NULL / IS NULL out loud: a
-- comparison on NULL yields NULL, and a CHECK that yields NULL passes.
ALTER TABLE "EmailVerifyConfig"
  ADD CONSTRAINT "EmailVerifyConfig_snowflakes_check" CHECK (
    ("unverifiedRoleId" IS NULL OR "unverifiedRoleId" ~ '^[0-9]{17,20}$')
    AND ("logChannelId" IS NULL OR "logChannelId" ~ '^[0-9]{17,20}$')
  ),
  ADD CONSTRAINT "EmailVerifyConfig_message_check" CHECK (
    "verifyMessage" IS NULL OR char_length("verifyMessage") BETWEEN 1 AND 1000
  );

ALTER TABLE "AccessRule"
  ADD CONSTRAINT "AccessRule_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "AccessRule_condition_check" CHECK (jsonb_typeof("condition") = 'object');

ALTER TABLE "MemberJoinInvite"
  ADD CONSTRAINT "MemberJoinInvite_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "MemberJoinInvite_inviteCode_check" CHECK ("inviteCode" ~ '^[A-Za-z0-9-]{2,32}$');

ALTER TABLE "EmailBlockPattern"
  ADD CONSTRAINT "EmailBlockPattern_pattern_check" CHECK (
    char_length("pattern") BETWEEN 1 AND 254 AND "pattern" = lower("pattern")
  );

ALTER TABLE "EmailList"
  ADD CONSTRAINT "EmailList_name_check" CHECK ("name" ~ '^[a-z0-9_-]{1,32}$');

ALTER TABLE "EmailListEntry"
  ADD CONSTRAINT "EmailListEntry_emailHash_check" CHECK ("emailHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "EmailVerification_emailHash_check" CHECK ("emailHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "EmailVerification_text_check" CHECK ("emailEnc" <> '' AND "domain" <> '');

ALTER TABLE "EmailVerifyPending"
  ADD CONSTRAINT "EmailVerifyPending_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "EmailVerifyPending_emailHash_check" CHECK ("emailHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "EmailVerifyPending_secrets_check" CHECK ("emailEnc" <> '' AND "codeHash" <> ''),
  ADD CONSTRAINT "EmailVerifyPending_counters_check" CHECK ("attempts" >= 0 AND "sendCount" >= 1);

ALTER TABLE "EmailSendDay"
  ADD CONSTRAINT "EmailSendDay_count_check" CHECK ("count" >= 0);

ALTER TABLE "EmailSendThrottle"
  ADD CONSTRAINT "EmailSendThrottle_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$'),
  ADD CONSTRAINT "EmailSendThrottle_count_check" CHECK ("count" >= 0);

ALTER TABLE "SmtpConfig"
  ADD CONSTRAINT "SmtpConfig_singleton_check" CHECK ("singleton"),
  ADD CONSTRAINT "SmtpConfig_port_check" CHECK ("port" BETWEEN 1 AND 65535),
  ADD CONSTRAINT "SmtpConfig_fields_check" CHECK (
    "host" <> '' AND "username" <> '' AND "passwordEnc" <> '' AND "fromAddress" LIKE '%_@_%'
  );
