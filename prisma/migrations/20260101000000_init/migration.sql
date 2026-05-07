-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "senderEmail" TEXT NOT NULL DEFAULT '',
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpPassEncrypted" TEXT NOT NULL DEFAULT '',
    "notificationEmails" TEXT NOT NULL DEFAULT '',
    "customerSubject" TEXT NOT NULL DEFAULT '',
    "customerBody" TEXT NOT NULL DEFAULT '',
    "merchantSubject" TEXT NOT NULL DEFAULT '',
    "merchantBody" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrackingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "metaPixelId" TEXT NOT NULL DEFAULT '',
    "metaCapiTokenEncrypted" TEXT NOT NULL DEFAULT '',
    "metaTestEventCode" TEXT NOT NULL DEFAULT '',
    "googleAdsConversionId" TEXT NOT NULL DEFAULT '',
    "googleAdsConversionLabel" TEXT NOT NULL DEFAULT '',
    "ga4MeasurementId" TEXT NOT NULL DEFAULT '',
    "ga4ApiSecretEncrypted" TEXT NOT NULL DEFAULT '',
    "gtmContainerId" TEXT NOT NULL DEFAULT '',
    "clientTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serverTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "internalNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "price" TEXT NOT NULL DEFAULT '0',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "eventId" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSettings_shopDomain_key" ON "EmailSettings"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingSettings_shopDomain_key" ON "TrackingSettings"("shopDomain");

-- CreateIndex
CREATE INDEX "Quote_shopDomain_createdAt_idx" ON "Quote"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_shopDomain_status_idx" ON "Quote"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- CreateIndex
CREATE INDEX "TrackingEvent_quoteId_idx" ON "TrackingEvent"("quoteId");

-- CreateIndex
CREATE INDEX "TrackingEvent_platform_status_idx" ON "TrackingEvent"("platform", "status");
