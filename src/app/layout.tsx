import type { Metadata, Viewport } from "next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SHOP_INSTAGRAM_URL,
  defaultOgImageUrl,
  siteUrl,
} from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute URLs are mandatory for Open Graph images; without metadataBase the
  // card is silently dropped by every platform.
  metadataBase: siteUrl(),
  title: {
    default: `${SITE_NAME} — Pre-Order`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [{ url: defaultOgImageUrl(), width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    // The card most DMs and shares actually render. `summary_large_image` is the
    // only one that shows the artwork at a readable size.
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [defaultOgImageUrl()],
  },
  robots: {
    // The storefront is meant to be shared; the admin panel is not indexed at all
    // (see the robots.txt route), and there is nothing private on a campaign page.
    index: true,
    follow: true,
  },
  other: {
    "instagram:site": SHOP_INSTAGRAM_URL,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

