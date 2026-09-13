-- Operator-editable configuration.
--
-- JSONB values so a new setting is a seed/UI change rather than a migration.
-- Key registry and coercion rules live in src/lib/pricing.ts.
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- Seed the flat delivery fee that was previously hardcoded in three source
-- files, so applying this migration does not change any price. ON CONFLICT
-- keeps it safe to run on a database where the seed (or an operator) already
-- wrote the row.
INSERT INTO "settings" ("key", "value", "updatedAt")
VALUES ('pricing.shipping_fee', '150'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
