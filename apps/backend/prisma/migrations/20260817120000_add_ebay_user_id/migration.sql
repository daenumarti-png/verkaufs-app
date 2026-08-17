-- AlterTable
ALTER TABLE "EbayConnection" ADD COLUMN     "ebayUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EbayConnection_ebayUserId_key" ON "EbayConnection"("ebayUserId");
