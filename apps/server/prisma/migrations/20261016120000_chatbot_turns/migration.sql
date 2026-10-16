-- CreateEnum
CREATE TYPE "ChatbotTurnStatus" AS ENUM ('OK', 'QUOTA_EXHAUSTED', 'NOT_CONFIGURED', 'FAILED');

-- CreateTable
CREATE TABLE "ChatbotTurn" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "triggerMessageId" TEXT NOT NULL,
    "replyMessageId" TEXT,
    "status" "ChatbotTurnStatus" NOT NULL,
    "failureReason" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "model" TEXT,
    "llmSource" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotTurn_triggerMessageId_key" ON "ChatbotTurn"("triggerMessageId");

-- CreateIndex
CREATE INDEX "ChatbotTurn_guildId_createdAt_idx" ON "ChatbotTurn"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ChatbotTurn_guildId_userId_createdAt_idx" ON "ChatbotTurn"("guildId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ChatbotTurn_createdAt_idx" ON "ChatbotTurn"("createdAt");

-- AddForeignKey
ALTER TABLE "ChatbotTurn" ADD CONSTRAINT "ChatbotTurn_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Constraints Prisma cannot express; documented with `///` on the model.
ALTER TABLE "ChatbotTurn"
  ADD CONSTRAINT "ChatbotTurn_ids_check" CHECK (
    "channelId" ~ '^[0-9]{17,20}$'
    AND "userId" ~ '^[0-9]{17,20}$'
    AND "triggerMessageId" ~ '^[0-9]{17,20}$'
    -- A NULL comparison passes a CHECK, which is what an unset reply wants.
    AND ("replyMessageId" IS NULL OR "replyMessageId" ~ '^[0-9]{17,20}$')
  ),
  ADD CONSTRAINT "ChatbotTurn_text_check" CHECK (
    char_length("question") <= 6000 AND ("answer" IS NULL OR char_length("answer") <= 12000)
  ),
  ADD CONSTRAINT "ChatbotTurn_tokens_check" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0),
  ADD CONSTRAINT "ChatbotTurn_answer_check" CHECK ("status" <> 'OK' OR "answer" IS NOT NULL);
