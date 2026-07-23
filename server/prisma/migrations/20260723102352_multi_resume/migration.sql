-- CreateTable
CREATE TABLE "Resume" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- DataMigration: carry each user's existing single resumeFilename into the
-- new Resume table as their primary, before the column disappears below.
INSERT INTO "Resume" ("userId", "filename", "isPrimary", "createdAt")
SELECT "id", "resumeFilename", 1, CURRENT_TIMESTAMP FROM "User" WHERE "resumeFilename" IS NOT NULL;

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
    "gmailOauthEmail" TEXT,
    "googleRefreshTokenEnc" TEXT,
    "signature" TEXT,
    "sendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "role", "sendEnabled", "signature") SELECT "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "role", "sendEnabled", "signature" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
