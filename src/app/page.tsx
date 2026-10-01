import { prisma } from "@/lib/db";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { BrandLogo } from "@/components/BrandLogo";
import { CartCountBadge } from "@/components/CartCountBadge";
import { CustomBagIcon } from "@/components/CustomerIcons";
import styles from "./page.module.css";
import StorefrontClient, { StorefrontProduct } from "./StorefrontClient";
import { TrustFooter } from "@/components/TrustFooter";
export const revalidate = 60; 
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
    <div className={styles.home}>
      <div className={styles.bgGradient} aria-hidden="true" />
      <div className={styles.bgOrb1} aria-hidden="true" />
      <div className={styles.bgOrb2} aria-hidden="true" />
      <div className={styles.bgOrb3} aria-hidden="true" />
      <div className={styles.bgNoise} aria-hidden="true" />
      <div className={styles.pageContent}>
        <nav className={styles.glassNav}>
          <div className={styles.glassNavInner}>
            <Link href="/" className={styles.navBrand} aria-label={SITE_NAME}>
              <BrandLogo variant="horizontal" height={34} />
            </Link>
            <div className={styles.navActions}>
              <Link href="/cart" className={styles.navCartBtn} id="nav-cart-link" aria-label="View Cart" title="View Cart">
                <CustomBagIcon size={16} />
                <span className={styles.navCartLabel}>Cart</span>
                <CartCountBadge />
              </Link>
            </div>
          </div>
        </nav>
        <main style={{ flex: 1 }}>
          {/* The document outline used to start at h2: there was no h1 anywhere on
              the shop home, which left search engines and screen readers without a
              page subject. This is the real title of the page, hidden because the
              showcase art already names the drop. */}
          <h1 className="visually-hidden">
            {SITE_NAME} — limited pre-order drops
          </h1>
          <StorefrontClient products={products} />
        </main>
        <TrustFooter batchEndAt={activeBatch?.endAt} />
      </div>
    </div>
  );
}
