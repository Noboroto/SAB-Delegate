-- AlterEnum
ALTER TYPE "ChatbotTurnStatus" ADD VALUE 'PENDING';
ALTER TYPE "ChatbotTurnStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "ChatbotTurn" ADD COLUMN     "period" TEXT,
ADD COLUMN     "reservedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ChatbotTurn_status_createdAt_idx" ON "ChatbotTurn"("status", "createdAt");


-- Constraints Prisma cannot express; documented with `///` on the model.
-- The new enum values are not named here: Postgres refuses to use a value in the
-- transaction that added it, and "answer is set when OK" already holds unchanged.
ALTER TABLE "ChatbotTurn"
  ADD CONSTRAINT "ChatbotTurn_reservation_check" CHECK (
    "reservedTokens" BETWEEN 0 AND 1000000000
    -- A NULL comparison passes a CHECK, which is what an unset period wants.
    AND ("period" IS NULL OR "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    AND ("reservedTokens" = 0 OR "period" IS NOT NULL)
  );
