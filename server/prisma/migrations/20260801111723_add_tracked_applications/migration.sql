-- CreateTable
CREATE TABLE "TrackedApplication" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "company" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "roleTitle" TEXT,
    "status" TEXT NOT NULL,
    "lastEmailSubject" TEXT NOT NULL,
    "lastEmailSnippet" TEXT,
    "lastEmailAt" DATETIME NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackedApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" DATETIME,
    "trackerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "trackerLastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "locked", "passwordHash", "plan", "planExpiresAt", "role", "sendEnabled", "signature") SELECT "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "locked", "passwordHash", "plan", "planExpiresAt", "role", "sendEnabled", "signature" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TrackedApplication_userId_lastEmailAt_idx" ON "TrackedApplication"("userId", "lastEmailAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedApplication_userId_companyKey_key" ON "TrackedApplication"("userId", "companyKey");
