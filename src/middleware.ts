import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/butigadmin") && !pathname.startsWith("/butigadmin/login")) {
    try {
      const { auth } = await import("@/lib/auth");
      const session = await auth();
      if (!session?.user) {
        const loginUrl = new URL("/butigadmin/login", request.url);
        return NextResponse.redirect(loginUrl);
      }
    } catch {
      const loginUrl = new URL("/butigadmin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }
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
    "/butigadmin/((?!login).*)",
    "/api/admin/:path*",
  ],
};
