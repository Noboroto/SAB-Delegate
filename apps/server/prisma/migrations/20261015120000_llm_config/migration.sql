-- CreateTable
CREATE TABLE "LlmConfig" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmConfig_singleton_key" ON "LlmConfig"("singleton");


-- Constraints Prisma cannot express; documented with `///` on the model.
ALTER TABLE "LlmConfig"
  ADD CONSTRAINT "LlmConfig_singleton_check" CHECK ("singleton"),
  ADD CONSTRAINT "LlmConfig_fields_check" CHECK (
    "baseUrl" LIKE 'https://%' AND "model" <> '' AND "apiKeyEnc" <> '' AND char_length("keyLast4") <= 4
  );
