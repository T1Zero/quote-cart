-- CreateTable
CREATE TABLE "Translations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "overridesEn" TEXT NOT NULL DEFAULT '{}',
    "overridesBg" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Translations_shopDomain_key" ON "Translations"("shopDomain");
