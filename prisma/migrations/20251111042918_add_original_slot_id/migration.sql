/*
  Warnings:

  - Added the required column `originalSlotId` to the `Absence` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Absence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childName" TEXT NOT NULL,
    "declaredClassBand" TEXT NOT NULL,
    "absentDate" DATETIME NOT NULL,
    "originalSlotId" TEXT NOT NULL,
    "contactEmail" TEXT,
    "resumeToken" TEXT NOT NULL,
    "makeupDeadline" DATETIME NOT NULL,
    "makeupStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Absence" ("absentDate", "childName", "contactEmail", "createdAt", "declaredClassBand", "id", "makeupDeadline", "makeupStatus", "resumeToken", "updatedAt", "originalSlotId") SELECT "absentDate", "childName", "contactEmail", "createdAt", "declaredClassBand", "id", "makeupDeadline", "makeupStatus", "resumeToken", "updatedAt", "UNKNOWN" FROM "Absence";
DROP TABLE "Absence";
ALTER TABLE "new_Absence" RENAME TO "Absence";
CREATE UNIQUE INDEX "Absence_resumeToken_key" ON "Absence"("resumeToken");
CREATE INDEX "Absence_resumeToken_idx" ON "Absence"("resumeToken");
CREATE INDEX "Absence_makeupStatus_idx" ON "Absence"("makeupStatus");
CREATE INDEX "Absence_originalSlotId_idx" ON "Absence"("originalSlotId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
