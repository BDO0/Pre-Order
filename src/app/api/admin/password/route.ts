import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api-guard";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { passwordProblem } from "@/lib/admin-password";

export const dynamic = "force-dynamic";

/**
 * Change your own password.
 *
 * Why this endpoint exists: the account an operator signs in with is created by
 * a setup script (`npm run db:seed` or `npm run admin:create`), and until they
 * can replace the password that script chose, the only way to fix a leaked one
 * is to run that script again from a shell with database credentials — which is
 * not advice a shop owner can follow at 11pm before a drop.
 *
 * Three deliberate choices:
 *
 *   • The account is taken from the *session*, never from the request body. A
 *     body-supplied id would turn "change my password" into "change any
 *     password".
 *   • The current password is required. A stolen session cookie should not be
 *     enough to lock the real operator out of their own shop.
 *   • The new password is never logged, not even on failure.
 *
 * The rules for what counts as an acceptable password live in
 * `src/lib/admin-password.ts`, which the setup scripts import too.
 */

function badRequest(code: string, message: string) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  try {
    // Before authentication: an unauthenticated flood should be cheap to turn
    // away, and an authenticated one should be counted the same way.
    const limited = enforceRateLimit(request, RATE_LIMITS.passwordChange);
    if (limited) return limited;

    const guard = await requireSession(request);
    if (!guard.ok) return guard.response;

    if (!guard.userId) {
      // A session minted before `id` was copied into the JWT. Nothing here can
      // know which account to change, and guessing would be worse than asking.
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SESSION_INCOMPLETE",
            message: "Your session is missing an account id. Sign out and sign in again.",
          },
        },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const currentPassword =
      typeof (body as { currentPassword?: unknown } | null)?.currentPassword === "string"
        ? (body as { currentPassword: string }).currentPassword
        : "";
    const newPassword =
      typeof (body as { newPassword?: unknown } | null)?.newPassword === "string"
        ? (body as { newPassword: string }).newPassword
        : "";

    if (currentPassword === "") {
      return badRequest("VALIDATION_ERROR", "Your current password is required.");
    }
    // One rule for the length, the ceiling and the old demo default; the same
    // function is what `scripts/admin-create.ts` refuses a password with.
    const problem = passwordProblem(newPassword);
    if (problem) {
      return badRequest("VALIDATION_ERROR", problem);
    }
    if (newPassword === currentPassword) {
      return badRequest(
        "VALIDATION_ERROR",
        "Your new password must be different from your current one."
      );
    }

    const admin = await prisma.admin.findUnique({
      where: { id: guard.userId },
      select: { id: true, email: true, active: true, passwordHash: true },
    });

    if (!admin || !admin.active) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "This account is no longer active." },
        },
        { status: 401 }
      );
    }

    const currentIsCorrect = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!currentIsCorrect) {
      // 400, not 401: the caller *is* authenticated. They mistyped a field.
      return badRequest("INVALID_PASSWORD", "That is not your current password.");
    }

    // Hashed before the transaction opens: bcrypt takes ~100ms, and holding a
    // transaction (and with it a pooled connection) open for that long would be
    // rude to every other request. The write and its audit entry still land
    // together, so a password change can never go unrecorded.
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: admin.id },
        data: { passwordHash },
      });

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "admin.password_changed",
          // Who and when, never what.
          metadata: { email: admin.email },
        },
      });
    });

    return NextResponse.json({ success: true, data: { changed: true } });
  } catch (error) {
    console.error("[POST /api/admin/password]", error);
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to change the password." },
      },
      { status: 500 }
    );
  }
}
