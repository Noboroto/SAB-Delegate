-- CreateTable
CREATE TABLE "Guild" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "discordId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "introChannelId" TEXT,
    "logChannelId" TEXT,
    "birthdayChannelId" TEXT,
    "activityCategoryId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guild_discordId_key" ON "Guild"("discordId");

