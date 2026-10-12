-- GuitarHub initial schema + extensions (SRS section 8)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "BanType" AS ENUM ('HARD', 'SHADOW');

-- CreateEnum
CREATE TYPE "Section" AS ENUM ('GENERAL', 'SONGS');

-- CreateEnum
CREATE TYPE "PresetKind" AS ENUM ('FILE', 'BUNDLE', 'CLOUD_LINK');

-- CreateEnum
CREATE TYPE "PresetStatus" AS ENUM ('DRAFT', 'QUARANTINE', 'PUBLISHED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "FileRole" AS ENUM ('PRIMARY', 'IR', 'DEMO_AUDIO');

-- CreateEnum
CREATE TYPE "ValidationMode" AS ENUM ('DEEP_JSON', 'SYSEX', 'FIXED_BINARY', 'SHALLOW', 'CLOUD_LINK');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('PRESET', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "tosVersion" TEXT,
    "tosAcceptedAt" TIMESTAMP(3),
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bannedAt" TIMESTAMP(3),
    "banType" "BanType",
    "banReason" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshFamily" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactorRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGear" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pedalId" TEXT NOT NULL,
    "firmwareVersion" TEXT,

    CONSTRAINT "UserGear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedal" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "aliases" TEXT[],
    "firmwareNotes" TEXT,
    "importInstructionsMd" TEXT NOT NULL DEFAULT '',
    "validationMode" "ValidationMode" NOT NULL,
    "maxPresetBytes" INTEGER NOT NULL DEFAULT 1048576,
    "maxBundleBytes" INTEGER NOT NULL DEFAULT 20971520,
    "maxCompanionBytes" INTEGER NOT NULL DEFAULT 5242880,
    "extensions" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pedalId" TEXT NOT NULL,
    "section" "Section" NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "songTitle" TEXT,
    "artist" TEXT,
    "album" TEXT,
    "year" INTEGER,
    "firmwareVersion" TEXT NOT NULL,
    "kind" "PresetKind" NOT NULL DEFAULT 'FILE',
    "cloudUrl" TEXT,
    "contentHash" TEXT,
    "storageKey" TEXT,
    "fileSize" INTEGER,
    "fileExt" TEXT,
    "extractedMeta" JSONB,
    "usesThirdPartyIr" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PresetStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "hotRank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresetFile" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "presetVersion" INTEGER NOT NULL,
    "role" "FileRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT,
    "ext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresetFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresetTag" (
    "presetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "PresetTag_pkey" PRIMARY KEY ("presetId","tagId")
);

-- CreateTable
CREATE TABLE "Vote" (
    "userId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("userId","presetId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadEvent" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_refreshFamily_idx" ON "Session"("refreshFamily");

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailToken_userId_type_idx" ON "EmailToken"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorRecoveryCode_userId_codeHash_key" ON "TwoFactorRecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserGear_userId_pedalId_key" ON "UserGear"("userId", "pedalId");

-- CreateIndex
CREATE UNIQUE INDEX "Pedal_slug_key" ON "Pedal"("slug");

-- CreateIndex
CREATE INDEX "Pedal_brand_idx" ON "Pedal"("brand");

-- CreateIndex
CREATE INDEX "Pedal_enabled_brand_model_idx" ON "Pedal"("enabled", "brand", "model");

-- CreateIndex
CREATE INDEX "Preset_pedalId_section_status_hotRank_idx" ON "Preset"("pedalId", "section", "status", "hotRank" DESC);

-- CreateIndex
CREATE INDEX "Preset_status_createdAt_idx" ON "Preset"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Preset_userId_status_idx" ON "Preset"("userId", "status");

-- CreateIndex
CREATE INDEX "Preset_contentHash_idx" ON "Preset"("contentHash");

-- CreateIndex
CREATE INDEX "PresetFile_presetId_presetVersion_idx" ON "PresetFile"("presetId", "presetVersion");

-- CreateIndex
CREATE INDEX "PresetFile_contentHash_idx" ON "PresetFile"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "PresetTag_tagId_idx" ON "PresetTag"("tagId");

-- CreateIndex
CREATE INDEX "Vote_presetId_idx" ON "Vote"("presetId");

-- CreateIndex
CREATE INDEX "Comment_presetId_createdAt_idx" ON "Comment"("presetId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "DownloadEvent_presetId_idx" ON "DownloadEvent"("presetId");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadEvent_presetId_clientKey_day_key" ON "DownloadEvent"("presetId", "clientKey", "day");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFactorRecoveryCode" ADD CONSTRAINT "TwoFactorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGear" ADD CONSTRAINT "UserGear_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGear" ADD CONSTRAINT "UserGear_pedalId_fkey" FOREIGN KEY ("pedalId") REFERENCES "Pedal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preset" ADD CONSTRAINT "Preset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preset" ADD CONSTRAINT "Preset_pedalId_fkey" FOREIGN KEY ("pedalId") REFERENCES "Pedal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetFile" ADD CONSTRAINT "PresetFile_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetTag" ADD CONSTRAINT "PresetTag_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetTag" ADD CONSTRAINT "PresetTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_handledBy_fkey" FOREIGN KEY ("handledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadEvent" ADD CONSTRAINT "DownloadEvent_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
