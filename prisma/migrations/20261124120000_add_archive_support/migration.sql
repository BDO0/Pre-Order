-- Add archivedAt soft-delete / archive timestamps to batches, products, and orders
ALTER TABLE "batches" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "batches_archivedAt_idx" ON "batches"("archivedAt");
CREATE INDEX "products_archivedAt_idx" ON "products"("archivedAt");
CREATE INDEX "orders_archivedAt_idx" ON "orders"("archivedAt");

-- Make OrderItem.variantId nullable with ON DELETE SET NULL so permanent deletion
-- of an archived product never deletes or alters historical order items/receipts
ALTER TABLE "order_items" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_variantId_fkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
