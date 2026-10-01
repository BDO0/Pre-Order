-- CreateTable
--
-- Backs the database rate limiter in src/lib/rate-limit.ts. Requests are counted
-- here instead of in a per-process Map so a budget survives a serverless cold
-- start and is shared by every concurrent instance.
--
-- This file has to exist for `prisma migrate deploy` to create the table.
-- `prisma generate` does not: it only produces client types, which is how this
-- schema change could compile cleanly and still be missing from production.
--
-- `resetAt` is indexed because the limiter prunes rows whose window closed over
-- an hour ago; without that index the prune is a sequential scan.
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");
