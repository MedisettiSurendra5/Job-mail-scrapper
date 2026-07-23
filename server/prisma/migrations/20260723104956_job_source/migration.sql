-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "applyUrl" TEXT,
    "jobRightId" TEXT,
    "title" TEXT,
    "company" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "workModel" TEXT,
    "seniority" TEXT,
    "datePosted" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'url',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" DATETIME,
    "addedById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("addedById", "applied", "appliedAt", "applyUrl", "company", "createdAt", "datePosted", "employmentType", "errorMessage", "id", "jobRightId", "location", "seniority", "status", "title", "url", "workModel") SELECT "addedById", "applied", "appliedAt", "applyUrl", "company", "createdAt", "datePosted", "employmentType", "errorMessage", "id", "jobRightId", "location", "seniority", "status", "title", "url", "workModel" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

