import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  batchOgImageUrl,
  SHOP_INSTAGRAM_HANDLE,
  SHOP_INSTAGRAM_URL,
  SITE_NAME,
} from "@/lib/site";
import { CustomBagIcon } from "@/components/CustomerIcons";
import { BrandLogo } from "@/components/BrandLogo";
import ProductPageClient from "./ProductPageClient";
import StorefrontClient, { StorefrontProduct } from "@/app/StorefrontClient";
import { prisma } from "@/lib/db";
import glass from "@/app/glass.module.css";
interface Props {
  params: Promise<{ slug: string }>;
}
const loadBatch = cache(async (slug: string) => {
  const batch = await prisma.batch.findUnique({
    where: { slug },
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
  });
  if (!batch) return null;
  const products: StorefrontProduct[] = batch.products
    .map((bp) => bp.product)
    .filter((p) => p.active)
    .map((p) => ({
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
    }));
  return {
    batch: {
      id: batch.id,
      name: batch.name,
      slug: batch.slug,
      description: batch.description,
      status: batch.status,
      coverImage: batch.coverImage,
      endAt: batch.endAt ? batch.endAt.toISOString() : null,
    },
    products,
  };
});
const loadProduct = cache(async (slug: string) => {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      variants: {
        where: { active: true },
      },
      batches: {
        include: {
          batch: true,
        },
      },
    },
  });
  if (!product || !product.active) return null;
  const linkedBatch =
    product.batches.find((b) => b.batch.status === "OPEN")?.batch ||
    product.batches[0]?.batch;
  const batch =
    linkedBatch ??
    (await prisma.batch.findFirst({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.batch.findFirst({
      orderBy: { createdAt: "desc" },
    }));
  if (!batch) return null;
  return {
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: Number(product.price),
      currency: product.currency,
      images: product.images,
      preorderStatus: product.preorderStatus,
      preorderRemaining:
        product.preorderLimit !== null
          ? Math.max(0, product.preorderLimit - product.preorderReserved)
          : null,
      variants: product.variants.map((v) => ({
        id: v.id,
        size: v.size,
        color: v.color,
        sku: v.sku,
        priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
        capacity: v.capacity,
        remainingCapacity: v.remainingCapacity,
        active: v.active,
      })),
    },
    batch: {
      id: batch.id,
      name: batch.name,
      slug: batch.slug,
      status: batch.status,
      endAt: batch.endAt ? batch.endAt.toISOString() : null,
    },
  };
});
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const batchData = await loadBatch(slug);
  if (batchData) {
    const title = `${batchData.batch.name} — Pre-Order Now | ${SITE_NAME}`;
    const description =
      batchData.batch.description ??
      `Explore the ${batchData.batch.name} pre-order collection at ${SITE_NAME}.`;
    const ogImages = [
      batchData.batch.coverImage
        ? {
            url: batchData.batch.coverImage,
            width: 1200,
            height: 630,
            alt: `${batchData.batch.name} — pre-order at ${SITE_NAME}`,
          }
        : {
            url: batchOgImageUrl(slug),
            width: 1200,
            height: 630,
            alt: `${batchData.batch.name} — pre-order at ${SITE_NAME}`,
          },
    ];
    return {
      title,
      description,
      alternates: { canonical: `/preorder/${slug}` },
      openGraph: {
        type: "website",
        siteName: SITE_NAME,
        title,
        description,
        url: `/preorder/${slug}`,
        images: ogImages,
      },
    };
  }
  const productData = await loadProduct(slug);
  if (productData) {
    const { product } = productData;
    const title = `${product.name} — Pre-Order Now | ${SITE_NAME}`;
    const description =
      product.description ??
      `Pre-order ${product.name} from ${SITE_NAME}. Limited quantities, confirmed personally on Instagram.`;
    const ogImages = product.images[0]
      ? [
          {
            url: product.images[0],
            width: 1200,
            height: 630,
            alt: `${product.name} — pre-order at ${SITE_NAME}`,
          },
        ]
      : [];
    return {
      title,
      description,
      alternates: { canonical: `/preorder/${slug}` },
      openGraph: {
        type: "website",
        siteName: SITE_NAME,
        title,
        description,
        url: `/preorder/${slug}`,
        images: ogImages,
      },
    };
  }
  return {
    title: "Not Found",
    robots: { index: false, follow: false },
  };
}
export default async function PreorderPage({ params }: Props) {
  const { slug } = await params;
  const batchData = await loadBatch(slug);
  if (batchData) {
    return (
      <div className={glass.glassPage} style={{ minHeight: "100dvh" }}>
        <div className={glass.bg} aria-hidden="true" />
        <div className={glass.orb1} aria-hidden="true" />
        <div className={glass.orb2} aria-hidden="true" />
        <div className={glass.orb3} aria-hidden="true" />
        <div className={glass.content}>
          <nav className={glass.nav}>
            <div className={glass.navInner}>
              <Link href="/" className={glass.navBrand} aria-label={SITE_NAME}>
                <BrandLogo variant="horizontal" height={34} />
              </Link>
              <div className={glass.navActions}>
                <Link href="/" className={glass.navGhostBtn} aria-label="Back to Shop">
                  ← <span className={glass.mobileHideText}>Back to </span>Shop
                </Link>
                <Link
                  href="/cart"
                  className={glass.navCartBtn}
                  id="nav-cart-link"
                >
                  <CustomBagIcon size={16} /> View Cart
                </Link>
              </div>
            </div>
          </nav>
          <StorefrontClient
            products={batchData.products}
          />
          <section style={{ maxWidth: "760px", margin: "var(--space-8) auto var(--space-16)", paddingInline: "var(--space-4)" }}>
            <div
              className={glass.glassCard}
              style={{
                padding: "var(--space-8) var(--space-6)",
                textAlign: "center",
              }}
            >
              <h2
                className={glass.pageTitleEditorial}
                style={{
                  fontSize: "1.5rem",
                  marginBottom: "var(--space-2)",
                }}
              >
                How pre-ordering works
              </h2>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "rgba(255, 255, 255, 0.7)",
                  maxWidth: "560px",
                  margin: "0 auto var(--space-5)",
                  lineHeight: 1.6,
                }}
              >
                Reserve your items here — no immediate payment is required. We reach out
                personally on Instagram to confirm your sizes, delivery address, and payment.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-4)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  fontSize: "var(--text-xs)",
                  color: "rgba(255, 255, 255, 0.8)",
                  marginBottom: "var(--space-5)",
                }}
              >
                <span>✓ Limited handcrafted batches</span>
                <span>✓ Verified personally via Instagram DM</span>
                <span>✓ Real-time reservation guaranteed</span>
              </div>
              <a
                href={SHOP_INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ display: "inline-block" }}
              >
                Message us @{SHOP_INSTAGRAM_HANDLE}
              </a>
            </div>
          </section>
        </div>
      </div>
    );
  }
  const productData = await loadProduct(slug);
  if (productData) {
    return (
      <ProductPageClient
        product={productData.product}
        batch={productData.batch}
      />
    );
  }
  notFound();
}
