import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const { GET } = handlers;

/**
 * Rate-limited credentials sign-in.
 *
 * The credentials callback is the one endpoint where guessing pays off, so it
 * gets a budget of its own. Only that path is throttled: CSRF-token fetches and
 * sign-out share this POST handler and must not be counted against it, or a
 * normal session would lock itself out.
 */
export async function POST(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.endsWith("/callback/credentials")) {
    const limited = enforceRateLimit(request, RATE_LIMITS.login);
    if (limited) return limited;
  }

  return handlers.POST(request);
}
