-- CreateEnum
CREATE TYPE "MeaningSource" AS ENUM ('WIKTIONARY', 'VNTK', 'LLM', 'NONE');

-- AlterTable
ALTER TABLE "ScrambleState" ADD COLUMN     "wrongGuesses" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VietWord" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "word" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "meaning" TEXT,
    "meaningSource" "MeaningSource",
    "meaningAt" TIMESTAMPTZ(3),

    CONSTRAINT "VietWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VietWord_word_key" ON "VietWord"("word");

-- CreateIndex
CREATE INDEX "VietWord_normalized_idx" ON "VietWord"("normalized");


-- Constraints Prisma cannot express; documented with `///` on the models.
ALTER TABLE "VietWord"
  ADD CONSTRAINT "VietWord_text_check" CHECK ("word" <> '' AND "normalized" <> ''),
  ADD CONSTRAINT "VietWord_meaning_check" CHECK (
    "meaningSource" IS NULL OR "meaningSource" = 'NONE' OR ("meaning" IS NOT NULL AND "meaning" <> '')
  );

ALTER TABLE "ScrambleState"
  ADD CONSTRAINT "ScrambleState_wrongGuesses_check" CHECK ("wrongGuesses" >= 0);
