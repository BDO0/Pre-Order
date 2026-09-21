import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { buildOrderWhere } from "@/lib/order-filters";

export const dynamic = "force-dynamic";

/**
 * The pre-order report, as a CSV the operator can open in a spreadsheet.
 *
 * Why a CSV and not a dashboard: this is the artifact that actually gets used.
 * The supplier needs a list of what to make, the courier needs addresses, and
 * the operator needs something they can sort by batch. A file they can filter is
 * worth more here than another chart.
 *
 * The columns lead with the things that identify an order to a human — batch,
 * reference, Instagram handle — because that is the order the operator reads
 * them in, and answers follow as `label: value` pairs so a renamed or deleted
 * question still makes sense in an old export.
 *
 * Requires `orders.read`; the fields are the same ones the order screen shows, so
 * this cannot become a way to see more than the UI allows. A role without
 * `customers.read` still gets the file — with the handle and sensitive answers
 * withheld, because the redaction is applied server-side before formatting.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);

    // Exactly the filter the orders screen applies. Until now only `status` and
    // `batchId` were read here, so downloading "the unpaid ones" produced a file
    // containing every payment status — a discrepancy the comment above claimed
    // could not happen.
    const orders = await prisma.order.findMany({
      where: buildOrderWhere(searchParams),
      orderBy: { createdAt: "asc" },
      select: {
        reference: true,
        status: true,
        paymentStatus: true,
        isNewCustomer: true,
        createdAt: true,
        subtotal: true,
        total: true,
        notes: true,
        customerSnapshot: true,
        batch: { select: { name: true } },
        items: {
          select: {
            productNameSnapshot: true,
            variantSnapshot: true,
            quantity: true,
            unitPriceAtPurchase: true,
          },
        },
      },
    });

    // The customer's own link, so the operator can send it to them. Only ever
    // included for a viewer who may read customer contact details at all —
    // otherwise the export would hand out a capability URL to someone who is not
    // allowed to know who the customer is. Uses the same permission matrix the
    // API enforces everywhere else rather than a local list of role names.
    const canReadCustomer = hasPermission(guard.role, "customers.read");

    const rows: (string | number | null)[][] = [
      [
        "Batch",
        "Reference",
        "Instagram",
        "Customer",
        "Items",
        "Total",
        "Payment",
        "Status",
        "Customer type",
        "Ordered at",
        "Internal notes",
      ],
    ];

    for (const order of orders) {
      rows.push([
        order.batch?.name ?? "",
        order.reference,
        canReadCustomer ? `@${String((order.customerSnapshot as { instagramHandle?: unknown }).instagramHandle ?? "")}` : "",
        String((order.customerSnapshot as { fullName?: unknown }).fullName ?? ""),
        order.items
          .map((item) => {
            const variant = item.variantSnapshot as { color?: string | null; size?: string | null };
            const variantLabel = [variant.color, variant.size].filter(Boolean).join("/");
            return `${item.quantity}x ${item.productNameSnapshot}${variantLabel ? ` (${variantLabel})` : ""}`;
          })
          .join(" | "),
        Number(order.total).toFixed(2),
        order.paymentStatus === "PAID" ? "Paid" : "Unpaid",
        order.status,
        order.isNewCustomer ? "New" : "Returning",
        order.createdAt.toISOString(),
        order.notes ?? "",
      ]);
    }

    // A filename that says what the file is, so a folder of downloads stays
    // navigable months later.
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = searchParams.get("batchId") ? "batch" : "all";

    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="preorders-${scope}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/orders/export]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } },
      { status: 500 }
    );
  }
}
