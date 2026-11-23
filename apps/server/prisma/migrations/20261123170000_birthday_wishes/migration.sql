-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN "birthdayWishesSeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BirthdayWish" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BirthdayWish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayWish_guildId_used_idx" ON "BirthdayWish"("guildId", "used");

-- AddForeignKey
ALTER TABLE "BirthdayWish" ADD CONSTRAINT "BirthdayWish_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The same bounds as BirthdayWishInputSchema: a wish always mentions the
-- celebrant and, once the mentions are filled in, fits one Discord message.
ALTER TABLE "BirthdayWish"
  ADD CONSTRAINT "BirthdayWish_text_check"
  CHECK (strpos("text", '${name}') > 0 AND char_length("text") BETWEEN 1 AND 1800);
