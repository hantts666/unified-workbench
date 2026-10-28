ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Session" ADD COLUMN "userAgent" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Session_id_key" ON "Session" ("id");
CREATE TABLE "AuthThrottle" (
  "key" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthThrottle_expiresAt_idx" ON "AuthThrottle" ("expiresAt");
