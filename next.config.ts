import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy.
 *
 * Scoped to what this app actually does: it talks only to its own origin, loads
 * its own images, and has no third-party embeds. The directives that matter most
 * are `object-src 'none'` (no plugin content), `base-uri 'self'` (a injected
 * <base> cannot re-point every relative URL) and `frame-ancestors 'none'`
 * (the admin panel cannot be framed and clickjacked).
 *
 * `script-src` has to allow inline scripts: Next.js injects its hydration
 * bootstrap inline, and removing that requires threading a per-request nonce
 * through the proxy, which is a larger change than this pass warranted. That is
 * a real, stated limitation rather than an oversight — the rest of the policy
 * still removes the entire class of "load attacker-controlled script" attacks.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Next injects inline <style> tags; inline styles cannot exfiltrate data.
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // `ws:` is only for the dev server's hot reload socket.
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Never in dev: it would force https:// on localhost.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Stops the browser guessing a content type — the reason an uploaded file
  // could ever be interpreted as HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Only over https, and only where it can actually take effect.
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  // The framework version is not information a customer needs.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
