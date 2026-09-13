-- Atomic per-day order reference allocation.
--
-- References used to be derived from MAX(reference) for the current day, which
-- two concurrent checkouts can read at the same time and then both attempt to
-- insert. This counter turns the allocation into one atomic statement.
CREATE TABLE "order_counters" (
    "day" DATE NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("day")
);

-- Seed from existing orders so a database that already issued numbers today
-- continues from its highest value instead of restarting at 1 and colliding.
-- The length guard keeps a malformed reference from overflowing the cast.
INSERT INTO "order_counters" ("day", "last_value", "updated_at")
SELECT substring("reference" from 4 for 8)::date,
       MAX(substring("reference" from 13)::integer),
       CURRENT_TIMESTAMP
FROM "orders"
WHERE "reference" ~ '^PO-[0-9]{8}-[0-9]+$'
  AND length("reference") <= 18
GROUP BY 1;
