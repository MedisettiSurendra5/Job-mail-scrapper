-- CreateTable
CREATE TABLE "EducationEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT,
    "fieldOfStudy" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EducationEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkHistoryEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT,
    "location" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WorkHistoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "resumeFilename" TEXT,
    "signature" TEXT,
    "sendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "addressStreet" TEXT,
    "addressCity" TEXT,
    "addressState" TEXT,
    "addressZip" TEXT,
    "addressCountry" TEXT,
    "linkedinUrl" TEXT,
    "portfolioUrl" TEXT,
    "workAuthStatus" TEXT,
    "needsSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "extensionTokenHash" TEXT
);
INSERT INTO "new_User" ("createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "sendEnabled", "signature") SELECT "createdAt", "email", "gmailAddress", "gmailAppPasswordEnc", "gmailOauthEmail", "googleRefreshTokenEnc", "id", "passwordHash", "plan", "planExpiresAt", "resumeFilename", "role", "sendEnabled", "signature" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

