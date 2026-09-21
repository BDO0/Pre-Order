import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * Backend authorization.
 *
 * Hiding a nav item is cosmetic — anyone can replay the request — so every
 * /api/admin route goes through here before it touches the database. The role
 * lives in the signed JWT, never in a request body or query string.
 */

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; fields?: unknown };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: { fields?: unknown }
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { success: false, error: { code, message, ...extra } },
    { status }
  );
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence-in-depth.
 *
 * NextAuth already issues SameSite=Lax cookies, which a cross-site POST cannot
 * carry. This adds an explicit origin check for the state-changing requests on
 * our own APIs so a misconfigured cookie setting cannot become an open door.
 *
 * A missing `Origin` header is allowed: that is a non-browser caller (curl, a
 * server-side fetch, a health check), and such a caller has no ambient session
 * cookie to abuse.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type GuardResult =
  | {
      ok: true;
      /** Email (or name) recorded on audit-log rows. */
      actor: string;
      /** Verified role, for logging and audit metadata. */
      role: string;
      /**
       * The session's user id, when the provider supplied one. Non-null for
       * every session this app mints — the JWT callback copies it in — and
       * needed by routes that act on the caller's *own* account.
       */
      userId: string | null;
    }
  | { ok: false; response: NextResponse<ApiErrorBody> };

const UNAUTHORIZED = { code: "UNAUTHORIZED", message: "Unauthorized." } as const;
const FORBIDDEN = {
  code: "FORBIDDEN",
  message: "Your role does not allow this action.",
} as const;

/**
 * Verifies the caller holds `permission`, and that a state-changing request came
 * from this origin.
 *
 * Usage:
 *   const guard = await requirePermission("orders.update", request);
 *   if (!guard.ok) return guard.response;
 *   // guard.actor / guard.role are now safe to use
 *
 * Returns a 401 when unauthenticated, 403 when the role lacks the permission,
 * and 403 on a cross-origin mutation.
 */
export async function requirePermission(
  permission: Permission,
  request: Request
): Promise<GuardResult> {
  // Typed structurally rather than via ReturnType<typeof auth>, whose overloads
  // include the middleware form (which has no `user`).
  let session: {
    user?: { id?: string | null; email?: string | null; name?: string | null };
  } | null;
  try {
    session = await auth();
  } catch (error) {
    console.error("[requirePermission] auth() failed", error);
    return { ok: false, response: apiError(401, UNAUTHORIZED.code, UNAUTHORIZED.message) };
  }

  if (!session?.user) {
    return { ok: false, response: apiError(401, UNAUTHORIZED.code, UNAUTHORIZED.message) };
  }

  const role = (session.user as { role?: unknown }).role;
  if (!hasPermission(typeof role === "string" ? role : null, permission)) {
    return {
      ok: false,
      response: apiError(403, FORBIDDEN.code, FORBIDDEN.message),
    };
  }

  if (UNSAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return {
      ok: false,
      response: apiError(
        403,
        "CROSS_ORIGIN_BLOCKED",
        "This request did not come from this site."
      ),
    };
  }

  return {
    ok: true,
    actor: session.user.email ?? session.user.name ?? "admin",
    role: typeof role === "string" ? role : "ADMIN",
    userId: session.user.id ?? null,
  };
}

/**
 * Verifies the caller is signed in, without asking for a permission.
 *
 * Every other guarded route names the permission it needs, because it acts on a
 * resource the matrix classifies. A password change acts on the caller's *own*
 * account, which every role owns — so demanding `settings.write` here would
 * mean an ORDER_MANAGER could not rotate their own password, and a VIEWER could
 * not rotate theirs at all.
 *
 * The identity comes from the session and never from the request body, so
 * "change my password" can only ever mean the signed-in admin.
 */
export async function requireSession(request: Request): Promise<GuardResult> {
  let session: {
    user?: { id?: string | null; email?: string | null; name?: string | null };
  } | null;
  try {
    session = await auth();
  } catch (error) {
    console.error("[requireSession] auth() failed", error);
    return { ok: false, response: apiError(401, UNAUTHORIZED.code, UNAUTHORIZED.message) };
  }

  if (!session?.user) {
    return { ok: false, response: apiError(401, UNAUTHORIZED.code, UNAUTHORIZED.message) };
  }

  if (UNSAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return {
      ok: false,
      response: apiError(
        403,
        "CROSS_ORIGIN_BLOCKED",
        "This request did not come from this site."
      ),
    };
  }

  const role = (session.user as { role?: unknown }).role;

  return {
    ok: true,
    actor: session.user.email ?? session.user.name ?? "admin",
    role: typeof role === "string" ? role : "ADMIN",
    userId: session.user.id ?? null,
  };
}
