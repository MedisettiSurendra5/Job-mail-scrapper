-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EducationEntry";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WorkHistoryEntry";
PRAGMA foreign_keys=on;

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
    "resumeFilename" TEXT,
    "signature" TEXT,
    "sendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "sendEnabled", "signature") SELECT "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "sendEnabled", "signature" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

