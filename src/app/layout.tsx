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
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [defaultOgImageUrl()],
  },
  robots: {
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
  themeColor: "#140207",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        The web fonts are linked here rather than with an `@import` inside
        globals.css. A CSS `@import` is only discovered after the browser has
        downloaded and parsed the main stylesheet, which serialises the two
        requests; a link in the head lets them go out in parallel. Preconnect
        opens the TLS session before the font request needs it.

        Cormorant Garamond is deliberately absent: --font-serif lists Playfair
        Display ahead of it, so it could never render, and requesting it cost
        four font files. Playfair italics went the same way - no rule sets
        font-style: italic.
      */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
