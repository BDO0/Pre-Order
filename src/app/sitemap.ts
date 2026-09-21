import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * sitemap.xml.
 *
 * Only the pages that are safe to index and useful to a stranger: the home page
 * and the campaigns that are actually open. Customer-specific pages (cart,
 * checkout, order status) are absent on purpose — an order-status URL contains a
 * capability token, and a sitemap is a public list.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl().origin;
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
  ];

  try {
    const { prisma } = await import("@/lib/db");
    const batches = await prisma.batch.findMany({
      where: { status: "OPEN" },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    for (const batch of batches) {
      entries.push({
        url: `${base}/preorder/${batch.slug}`,
        lastModified: batch.updatedAt,
        changeFrequency: "daily",
        priority: 0.9,
      });
    }
  } catch {
    // A sitemap that cannot reach the database is still a valid sitemap for the
    // home page; failing the route would only break the crawler.
  }

  return entries;
}
