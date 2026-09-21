import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * robots.txt.
 *
 * The admin panel is disallowed explicitly rather than merely unlinked: it is a
 * password-protected tool for one person, and there is no upside to a crawler
 * discovering its login page or any of its URLs.
 *
 * The public order-status page is disallowed too, and that matters more than it
 * looks: every URL there carries a capability token, so an indexed link would
 * hand a stranger somebody's order. The tokens are unguessable, but a crawler
 * that followed one shared link would happily publish it.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl().origin;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/preorder/"],
        disallow: ["/admin", "/api/", "/order-status", "/order-success", "/cart", "/checkout"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
