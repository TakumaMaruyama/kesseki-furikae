-- AlterTable
ALTER TABLE "Request" ADD COLUMN "absenceId" TEXT;

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childName" TEXT NOT NULL,
    "declaredClassBand" TEXT NOT NULL,
    "absentDate" DATETIME NOT NULL,
    "contactEmail" TEXT,
    "resumeToken" TEXT NOT NULL,
    "makeupDeadline" DATETIME NOT NULL,
    "makeupStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Absence_resumeToken_key" ON "Absence"("resumeToken");

-- CreateIndex
CREATE INDEX "Absence_resumeToken_idx" ON "Absence"("resumeToken");

-- CreateIndex
CREATE INDEX "Absence_makeupStatus_idx" ON "Absence"("makeupStatus");

-- CreateIndex
CREATE INDEX "Request_toSlotId_idx" ON "Request"("toSlotId");

-- CreateIndex
CREATE INDEX "Request_status_idx" ON "Request"("status");

-- CreateIndex
CREATE INDEX "Request_absenceId_idx" ON "Request"("absenceId");
