-- CreateTable
--
-- Per-colour product images: one row per image an admin attaches to a colour
-- option, so a product can show "Black" in black and "Bone" in bone instead of
-- the same default gallery for every option.
--
-- Options are keyed by `colorKey` (the colour label trimmed and lowercased)
-- rather than by `product_variants.id` because src/lib/variant-plan.ts retires
-- and recreates a variant when its colour or size label changes; a variant id
-- would silently drop the image on a rename.
--
-- The table starts empty, which is the intended fallback: a colour with no rows
-- here keeps using the product's default gallery (`products.images`), so this
-- migration changes nothing until an admin uploads a colour image.
--
-- This file has to exist for `prisma migrate deploy` to create the table.
CREATE TABLE "product_color_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "colorLabel" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_color_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Supports a whole product's colour images in one ordered read.
CREATE INDEX "product_color_images_productId_idx" ON "product_color_images"("productId");

-- CreateIndex
-- One row per (product, colour, slot): re-saving the admin form updates the
-- existing row instead of accumulating duplicates.
CREATE UNIQUE INDEX "product_color_images_productId_colorKey_sortOrder_key" ON "product_color_images"("productId", "colorKey", "sortOrder");

-- AddForeignKey
ALTER TABLE "product_color_images" ADD CONSTRAINT "product_color_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
