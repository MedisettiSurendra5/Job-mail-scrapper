-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "applyFilters" BOOLEAN NOT NULL DEFAULT true,
    "country" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "seniority" TEXT NOT NULL DEFAULT 'Entry Level,Mid Level',
    "jobTypes" TEXT NOT NULL DEFAULT 'Full-time',
    "workModel" TEXT NOT NULL DEFAULT '',
    "daysAgo" TEXT NOT NULL DEFAULT 'Past 24 hours',
    "maxPerRun" INTEGER NOT NULL DEFAULT 10,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "sendAsUserId" INTEGER,
    "intervalHours" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRule_sendAsUserId_fkey" FOREIGN KEY ("sendAsUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
