-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenHash" TEXT,
ADD COLUMN     "stepUpAt" TIMESTAMP(3),
ADD COLUMN     "usedHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "links" JSONB,
ADD COLUMN     "pendingEmail" TEXT,
ADD COLUMN     "totpPendingSecret" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

