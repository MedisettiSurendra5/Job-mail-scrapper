-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "gmailAddress" TEXT,
    "gmailAppPasswordEnc" TEXT,
    "resumeFilename" TEXT,
    "signature" TEXT,
    "sendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "canViewAllJobs" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("canViewAllJobs", "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "signature") SELECT "canViewAllJobs", "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "signature" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
