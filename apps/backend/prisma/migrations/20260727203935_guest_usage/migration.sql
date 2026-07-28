-- CreateTable
CREATE TABLE "GuestUsage" (
    "deviceId" TEXT NOT NULL,
    "itemsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestUsage_pkey" PRIMARY KEY ("deviceId")
);
