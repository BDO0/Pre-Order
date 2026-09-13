import { readFile, stat } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api-guard";
import {
  isSafeStorageKey,
  mimeTypeForKey,
  proofCandidatesForKey,
} from "@/lib/uploads";
import { basename } from "node:path";

/**
 * Streams a payment proof to an authenticated admin.
 *
 * Proofs are screenshots of a customer's banking app: names, account numbers,
 * reference numbers, sometimes a whole transaction history. They used to be
 * written to `public/uploads` and handed a public URL, which meant the only
 * thing protecting them was the randomness of the filename.
 *
 * New proofs live outside `public/` and are only readable through this route,
 * behind `orders.read`. A catch-all segment is used because a storage key can
 * contain a slash (`proofs/<id>.webp`), which a single `[key]` cannot match.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;

    const { key } = await params;
    const storageKey = (key ?? []).map((part) => decodeURIComponent(part)).join("/");

    // Refuses `..`, absolute paths, drive letters and control characters before
    // anything reaches the filesystem.
    if (!isSafeStorageKey(storageKey)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_KEY", message: "Invalid proof key." } },
        { status: 400 }
      );
    }

    for (const candidate of proofCandidatesForKey(storageKey)) {
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;

        const bytes = await readFile(candidate);

        return new NextResponse(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": mimeTypeForKey(storageKey),
            "Content-Length": String(bytes.byteLength),
            "Content-Disposition": `inline; filename="${basename(candidate)}"`,
            // Private: a shared cache must never hold a customer's receipt.
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        // Try the next candidate (the legacy public/uploads location).
      }
    }

    return NextResponse.json(
      { success: false, error: { code: "PROOF_NOT_FOUND", message: "Proof not found." } },
      { status: 404 }
    );
  } catch (error) {
    console.error("[GET /api/admin/proofs/[...key]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
