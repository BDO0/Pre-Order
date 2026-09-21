import { prisma } from "@/lib/db";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import styles from "./page.module.css";
import StorefrontClient, { StorefrontProduct } from "./StorefrontClient";

export const revalidate = 60; // revalidate every minute

async function getAvailableProducts(): Promise<{
  products: StorefrontProduct[];
  activeBatch: { name: string; description: string | null; endAt: string | null } | null;
}> {
  const batches = await prisma.batch.findMany({
    where: { status: "OPEN" },
    include: {
      products: {
        include: {
          product: {
            include: {
              variants: {
                where: { active: true },
                orderBy: [{ color: "asc" }, { size: "asc" }],
              },
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const defaultBatch = batches[0] ?? null;
  const productsMap = new Map<string, StorefrontProduct>();

  for (const batch of batches) {
    for (const batchProduct of batch.products) {
      const p = batchProduct.product;
      if (!p.active) continue;

      productsMap.set(p.id, {
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: Number(p.price),
        category: p.category,
        description: p.description,
        images: Array.isArray(p.images) ? p.images : [],
        batchId: batch.id,
        batchName: batch.name,
        batchSlug: batch.slug,
        batchEndAt: batch.endAt ? batch.endAt.toISOString() : null,
        preorderStatus: p.preorderStatus,
        preorderRemaining:
          p.preorderLimit !== null
            ? Math.max(0, p.preorderLimit - p.preorderReserved)
            : null,
        variants: p.variants.map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          sku: v.sku,
          priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
          capacity: v.capacity,
          remainingCapacity: v.remainingCapacity,
          active: v.active,
        })),
      });
    }
  }

  // Fallback: If any active preorder-enabled products are not in an OPEN batch,
  // associate them with the default batch so they can be viewed and pre-ordered.
  if (defaultBatch) {
    const allActive = await prisma.product.findMany({
      where: { active: true, preorderEnabled: true },
      include: {
        variants: {
          where: { active: true },
          orderBy: [{ color: "asc" }, { size: "asc" }],
        },
      },
    });

    for (const p of allActive) {
      if (!productsMap.has(p.id)) {
        productsMap.set(p.id, {
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: Number(p.price),
          category: p.category,
          description: p.description,
          images: Array.isArray(p.images) ? p.images : [],
          batchId: defaultBatch.id,
          batchName: defaultBatch.name,
          batchSlug: defaultBatch.slug,
          batchEndAt: defaultBatch.endAt ? defaultBatch.endAt.toISOString() : null,
          preorderStatus: p.preorderStatus,
          preorderRemaining:
            p.preorderLimit !== null
              ? Math.max(0, p.preorderLimit - p.preorderReserved)
              : null,
          variants: p.variants.map((v) => ({
            id: v.id,
            size: v.size,
            color: v.color,
            sku: v.sku,
            priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
            capacity: v.capacity,
            remainingCapacity: v.remainingCapacity,
            active: v.active,
          })),
        });
      }
    }
  }

  return {
    products: Array.from(productsMap.values()),
    activeBatch: defaultBatch
      ? {
          name: defaultBatch.name,
          description: defaultBatch.description,
          endAt: defaultBatch.endAt ? defaultBatch.endAt.toISOString() : null,
        }
      : null,
  };
}

export default async function HomePage() {
  const { products, activeBatch } = await getAvailableProducts();

  return (
    <main className={styles.home}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link href="/" className="navbar-brand">
            {SITE_NAME}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {/* The only public way back to an order for a customer who closed the
                confirmation tab: `/order-status` takes the order number plus the
                Instagram username it was placed with. Without this link the page
                existed and nothing pointed at it. */}
            <Link href="/order-status" className="btn btn-ghost btn-sm">
              Track Order
            </Link>
            <Link href="/cart" className="btn btn-secondary btn-sm" id="nav-cart-link">
              🛒 View Cart
            </Link>
          </div>
        </div>
      </nav>
      <StorefrontClient
        products={products}
        campaignTitle={activeBatch?.name}
        campaignDescription={activeBatch?.description}
        campaignEndAt={activeBatch?.endAt}
      />
    </main>
  );
}
