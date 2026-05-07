-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "shopifyDraftOrderId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "shopifyDraftOrderName" TEXT;
ALTER TABLE "Quote" ADD COLUMN "shopifyDraftOrderUrl" TEXT;

-- CreateTable
CREATE TABLE "OrderSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "autoCreateDraft" BOOLEAN NOT NULL DEFAULT false,
    "autoSendInvoice" BOOLEAN NOT NULL DEFAULT false,
    "draftOrderTag" TEXT NOT NULL DEFAULT 'quote-cart',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSettings_shopDomain_key" ON "OrderSettings"("shopDomain");
