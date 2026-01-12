-- CreateTable
CREATE TABLE "GlobalSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "makeupWindowDays" INTEGER NOT NULL DEFAULT 30,
    "cutoffTime" TEXT NOT NULL DEFAULT '16:00'
);

-- CreateTable
CREATE TABLE "ClassSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "courseLabel" TEXT NOT NULL,
    "classBand" TEXT NOT NULL,
    "capacityLimit" INTEGER NOT NULL,
    "capacityCurrent" INTEGER NOT NULL,
    "capacityMakeupAllowed" INTEGER NOT NULL,
    "capacityMakeupUsed" INTEGER NOT NULL DEFAULT 0,
    "waitlistCount" INTEGER NOT NULL DEFAULT 0,
    "lessonStartDateTime" DATETIME NOT NULL,
    "lastNotifiedRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childName" TEXT NOT NULL,
    "declaredClassBand" TEXT NOT NULL,
    "absentDate" DATETIME NOT NULL,
    "toSlotId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contactEmail" TEXT,
    "confirmToken" TEXT,
    "declineToken" TEXT,
    "toSlotStartDateTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
