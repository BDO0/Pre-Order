import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only run protection logic for admin pages (not the login page itself)
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    try {
      // Dynamically import auth to avoid breaking the proxy on db errors
      const { auth } = await import("@/lib/auth");
      const session = await auth();

      if (!session?.user) {
        const loginUrl = new URL("/admin/login", request.url);
        return NextResponse.redirect(loginUrl);
      }
    } catch {
      // If auth/db fails (e.g. no DB connected yet), redirect to login
      const loginUrl = new URL("/admin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Protect /api/admin routes (not the auth endpoint)
  if (pathname.startsWith("/api/admin")) {
    try {
      const { auth } = await import("@/lib/auth");
      const session = await auth();

      if (!session?.user) {
        return NextResponse.json(
          { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect admin pages but NOT the login page
    "/admin/((?!login).*)",
    "/api/admin/:path*",
  ],
};
