-- CreateEnum
CREATE TYPE "MiniGame" AS ENUM ('WORD_CHAIN', 'COUNTING', 'SCRAMBLE', 'WORDLE');

-- CreateTable
CREATE TABLE "GameChannel" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "game" "MiniGame" NOT NULL,
    "channelId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountingState" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastUserId" TEXT NOT NULL DEFAULT '',
    "best" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CountingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrambleState" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "answer" TEXT NOT NULL,
    "puzzle" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScrambleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordleState" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "answer" TEXT NOT NULL,
    "guesses" TEXT[],
    "lastUserId" TEXT NOT NULL DEFAULT '',
    "round" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WordleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameScore" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "guildId" UUID NOT NULL,
    "game" "MiniGame" NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameChannel_channelId_key" ON "GameChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "GameChannel_guildId_game_key" ON "GameChannel"("guildId", "game");

-- CreateIndex
CREATE UNIQUE INDEX "CountingState_guildId_key" ON "CountingState"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "ScrambleState_guildId_key" ON "ScrambleState"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "WordleState_guildId_key" ON "WordleState"("guildId");

-- CreateIndex
CREATE INDEX "GameScore_guildId_game_points_idx" ON "GameScore"("guildId", "game", "points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "GameScore_guildId_game_userId_key" ON "GameScore"("guildId", "game", "userId");

-- AddForeignKey
ALTER TABLE "GameChannel" ADD CONSTRAINT "GameChannel_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountingState" ADD CONSTRAINT "CountingState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrambleState" ADD CONSTRAINT "ScrambleState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordleState" ADD CONSTRAINT "WordleState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameScore" ADD CONSTRAINT "GameScore_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Constraints Prisma cannot express; each is documented with `///` on its model.

-- Prisma leaves list columns nullable; a NULL list would read as "no guess".
ALTER TABLE "WordleState" ALTER COLUMN "guesses" SET NOT NULL;

ALTER TABLE "GameChannel"
  ADD CONSTRAINT "GameChannel_channelId_check" CHECK ("channelId" ~ '^[0-9]{17,20}$');

ALTER TABLE "CountingState"
  ADD CONSTRAINT "CountingState_count_check" CHECK ("count" >= 0 AND "best" >= 0);

ALTER TABLE "ScrambleState"
  ADD CONSTRAINT "ScrambleState_puzzle_check" CHECK ("answer" <> '' AND "puzzle" <> '' AND "round" >= 0);

ALTER TABLE "WordleState"
  ADD CONSTRAINT "WordleState_board_check" CHECK (
    "answer" ~ '^[a-z]{5}$' AND cardinality("guesses") <= 6 AND "round" >= 0
  );

ALTER TABLE "GameScore"
  ADD CONSTRAINT "GameScore_points_check" CHECK ("points" >= 0),
  ADD CONSTRAINT "GameScore_userId_check" CHECK ("userId" ~ '^[0-9]{17,20}$');
