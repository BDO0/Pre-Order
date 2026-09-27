import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
export const { GET } = handlers;
export async function POST(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.endsWith("/callback/credentials")) {
    const limited = enforceRateLimit(request, RATE_LIMITS.login);
    if (limited) return limited;
  }
  return handlers.POST(request);
}
