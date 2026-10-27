-- CreateTable
CREATE TABLE "LedgerBinding" (
    "id" TEXT NOT NULL,
    "platformCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "taxId" TEXT NOT NULL DEFAULT '',
    "siteName" TEXT NOT NULL,
    "erpCompany" TEXT NOT NULL,
    "apiCredential" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lockedThrough" TEXT NOT NULL DEFAULT '',
    "provisionStatus" TEXT NOT NULL DEFAULT 'READY',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LedgerBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "suggestion" JSONB,
    "error" TEXT,
    "erpName" TEXT,
    "invoiceNumber" TEXT,
    "processingVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "manager" TEXT NOT NULL,
    "contractCents" INTEGER NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "erpProject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "memo" TEXT NOT NULL,
    "matchedErpName" TEXT,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorDisplayNameSnapshot" TEXT,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessorConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,

    CONSTRAINT "ProcessorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBinding_platformCompanyId_key" ON "LedgerBinding"("platformCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBinding_siteName_erpCompany_key" ON "LedgerBinding"("siteName", "erpCompany");

-- CreateIndex
CREATE INDEX "Document_tenantId_status_idx" ON "Document"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_contentHash_key" ON "Document"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_invoiceNumber_key" ON "Document"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Project_tenantId_idx" ON "Project"("tenantId");

-- CreateIndex
CREATE INDEX "BankTransaction_tenantId_idx" ON "BankTransaction"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_tenantId_fingerprint_key" ON "BankTransaction"("tenantId", "fingerprint");

-- CreateIndex
CREATE INDEX "Audit_tenantId_createdAt_idx" ON "Audit"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "LedgerBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "LedgerBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "LedgerBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
