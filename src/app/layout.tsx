import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ANA Clothing — Pre-Order",
    template: "%s | ANA Clothing",
  },
  description: "Browse and pre-order the latest ANA Clothing collections.",
  openGraph: {
    type: "website",
    siteName: "ANA Clothing",
  },
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
