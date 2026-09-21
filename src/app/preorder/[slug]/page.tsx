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
import ProductPageClient from "./ProductPageClient";
import StorefrontClient, { StorefrontProduct } from "@/app/StorefrontClient";
import { prisma } from "@/lib/db";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Fetch a batch by slug (for campaign drops).
 *
 * Wrapped in React's `cache()`: `generateMetadata` and the page itself both
 * ask for the same slug in the same request, which was two identical queries
 * per page view. `cache()` is per-request, so a visitor still sees fresh
 * data - it only removes the duplicate.
 */
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

/**
 * Fetch a product and the batch it sits in.
 *
 * Cached per request for the same reason as `loadBatch`: `generateMetadata`
 * and the page both need it, and the second read was pure duplication.
 */
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

  // The batch to show this product under: the one it is really in, preferring an
  // open one. A product with no batch link still needs a drop to appear under, so
  // the newest open batch is the fallback.
  const linkedBatch =
    product.batches.find((b) => b.batch.status === "OPEN")?.batch ||
    product.batches[0]?.batch;

  // This used to insert the missing link right here, while a customer was reading
  // the page: a write on a read path, run twice per request, with the error
  // swallowed. Removing it needed a real replacement, because that write is what
  // made the link exist at all - `ensureProductInOpenBatch` in
  // `@/lib/batch-service`, called from the admin product routes, which is where
  // the rest of the catalogue is written. Nothing on this page writes now.
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

  // Check batch metadata first
  const batchData = await loadBatch(slug);
  if (batchData) {
    const title = `${batchData.batch.name} — Pre-Order Now | ${SITE_NAME}`;
    const description =
      batchData.batch.description ??
      `Explore the ${batchData.batch.name} pre-order collection at ${SITE_NAME}.`;

    // This is the link the operator shares — the admin panel's "Copy link" button
    // exists to put exactly this URL on the clipboard — so it has to unfurl into a
    // card. Without an openGraph block here the share arrived as a bare URL with
    // no picture, while the product pages below had a card all along.
    //
    // The operator's own cover image wins; the generated card is the fallback, for
    // a batch that has no artwork yet.
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

  // Check product metadata
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

  // 1. Is this slug a Campaign / Batch?
  const batchData = await loadBatch(slug);
  if (batchData) {
    return (
      <main style={{ minHeight: "100dvh", background: "var(--color-bg-main)" }}>
        {/* Navbar */}
        <nav className="navbar">
          <div className="container navbar-inner">
            <Link href="/" className="navbar-brand">
              ANA Clothing
            </Link>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <Link href="/" className="btn btn-ghost btn-sm">
                ← All Drops
              </Link>
              <Link href="/cart" className="btn btn-secondary btn-sm">
                🛒 Cart
              </Link>
            </div>
          </div>
        </nav>

        {/* Campaign Storefront with Two-Column Split Layout */}
        <StorefrontClient
          products={batchData.products}
          campaignTitle={batchData.batch.name}
          campaignDescription={batchData.batch.description}
          campaignEndAt={batchData.batch.endAt}
          campaignStatus={batchData.batch.status}
        />

        {/* Trust strip */}
        <section className="container" style={{ paddingBlock: "var(--space-8) var(--space-16)" }}>
          <div
            className="card"
            style={{ maxWidth: "760px", marginInline: "auto", textAlign: "center" }}
          >
            <div className="card-body">
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 700,
                  marginBottom: "var(--space-3)",
                }}
              >
                How pre-ordering works
              </h2>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-neutral-600)",
                  maxWidth: "560px",
                  marginInline: "auto",
                }}
              >
                Reserve your items here — no immediate payment is required. We reach out
                personally on Instagram to confirm your sizes, delivery address, and payment.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-6)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  marginTop: "var(--space-6)",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-neutral-700)",
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
                className="btn btn-secondary"
                style={{ marginTop: "var(--space-6)", display: "inline-block" }}
              >
                Message us @{SHOP_INSTAGRAM_HANDLE}
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // 2. Is this slug a Product?
  const productData = await loadProduct(slug);
  if (productData) {
    return (
      <>
        <ProductPageClient
          product={productData.product}
          batch={productData.batch}
        />

        {/* Trust strip */}
        <section className="container" style={{ paddingBlock: "var(--space-12)" }}>
          <div
            className="card"
            style={{ maxWidth: "760px", marginInline: "auto", textAlign: "center" }}
          >
            <div className="card-body">
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 700,
                  marginBottom: "var(--space-3)",
                }}
              >
                How ordering works
              </h2>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-neutral-600)",
                  maxWidth: "560px",
                  marginInline: "auto",
                }}
              >
                Reserve your pieces here — no payment is taken on this site. We message you
                on Instagram to confirm sizing, shipping and payment, and your order is
                reserved the moment you place it.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-6)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  marginTop: "var(--space-6)",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-neutral-700)",
                }}
              >
                <span>✓ Limited, made-to-order pieces</span>
                <span>✓ Confirmed personally on Instagram</span>
                <span>✓ Your own private order link</span>
              </div>
              <a
                href={SHOP_INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ marginTop: "var(--space-6)", display: "inline-block" }}
              >
                Message us @{SHOP_INSTAGRAM_HANDLE}
              </a>
            </div>
          </div>
        </section>
      </>
    );
  }

  // Neither matched
  notFound();
}
