import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { hasPermission } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { buildOrderWhere } from "@/lib/order-filters";

export const dynamic = "force-dynamic";

interface ExportOrderItem {
  productNameSnapshot: string;
  variantSnapshot: unknown;
  quantity: number;
  unitPriceAtPurchase: unknown;
}

interface ExportOrder {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  isNewCustomer: boolean;
  customerId: string | null;
  createdAt: Date;
  subtotal: unknown;
  total: unknown;
  notes: string | null;
  customerSnapshot: unknown;
  batch: { name: string } | null;
  items: ExportOrderItem[];
}

interface CustomerOrderGroup {
  initialOrder: ExportOrder;
  followingOrders: ExportOrder[];
  allOrders: ExportOrder[];
}

function isOrderCancelled(status: string): boolean {
  return status === "CANCELLED" || status === "REJECTED";
}

function getCustomerKey(order: ExportOrder): string {
  const snapshot = order.customerSnapshot as {
    instagramHandle?: unknown;
    fullName?: unknown;
  } | null;
  const ig =
    typeof snapshot?.instagramHandle === "string"
      ? snapshot.instagramHandle.trim().toLowerCase().replace(/^@/, "")
      : "";
  if (ig) return `ig:${ig}`;
  if (order.customerId) return `cust:${order.customerId}`;
  const name =
    typeof snapshot?.fullName === "string"
      ? snapshot.fullName.trim().toLowerCase()
      : "";
  if (name) return `name:${name}`;
  return `ref:${order.reference}`;
}

function groupOrdersByCustomer(ordersList: ExportOrder[]): CustomerOrderGroup[] {
  const groups = new Map<string, CustomerOrderGroup>();
  for (const order of ordersList) {
    const key = getCustomerKey(order);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        initialOrder: order,
        followingOrders: [],
        allOrders: [order],
      });
    } else {
      existing.followingOrders.push(order);
      existing.allOrders.push(order);
    }
  }
  return Array.from(groups.values());
}

function formatOrderItems(items: ExportOrderItem[]): string {
  return items
    .map((item) => {
      const variant = item.variantSnapshot as {
        color?: string | null;
        size?: string | null;
      } | null;
      const variantLabel = [variant?.color, variant?.size]
        .filter(Boolean)
        .join("/");
      return `${item.quantity}x ${item.productNameSnapshot}${
        variantLabel ? ` (${variantLabel})` : ""
      }`;
    })
    .join(" | ");
}

function formatGroupRow(
  group: CustomerOrderGroup,
  canReadCustomer: boolean
): (string | number | null)[] {
  const { initialOrder, followingOrders, allOrders } = group;
  const isMerged = followingOrders.length > 0;

  const batchNames = Array.from(
    new Set(allOrders.map((o) => o.batch?.name).filter(Boolean))
  );
  const batchStr = batchNames.join(", ");

  const referenceStr = isMerged
    ? `${allOrders.map((o) => o.reference).join(" + ")} (Merged ${allOrders.length} orders)`
    : initialOrder.reference;

  const snapshot = initialOrder.customerSnapshot as {
    instagramHandle?: unknown;
    fullName?: unknown;
  } | null;
  const rawIg =
    typeof snapshot?.instagramHandle === "string"
      ? snapshot.instagramHandle.trim().replace(/^@/, "")
      : "";
  const instagramStr = canReadCustomer && rawIg ? `@${rawIg}` : "";

  const customerName =
    typeof snapshot?.fullName === "string" ? snapshot.fullName : "";

  const itemsStr = isMerged
    ? allOrders
        .map((order, idx) => {
          const prefix =
            idx === 0
              ? `[Initial ${order.reference}]`
              : `[Follow-up ${order.reference}]`;
          const orderItemsFormatted = formatOrderItems(order.items);
          return `${prefix} ${orderItemsFormatted}`;
        })
        .join(" | ")
    : formatOrderItems(initialOrder.items);

  const totalSum = allOrders
    .reduce((sum, o) => sum + Number(o.total), 0)
    .toFixed(2);

  let paymentStr = "";
  if (!isMerged) {
    paymentStr = initialOrder.paymentStatus === "PAID" ? "Paid" : "Unpaid";
  } else {
    const allPaid = allOrders.every((o) => o.paymentStatus === "PAID");
    const allUnpaid = allOrders.every((o) => o.paymentStatus === "UNPAID");
    if (allPaid) paymentStr = "Paid (All)";
    else if (allUnpaid) paymentStr = "Unpaid (All)";
    else {
      paymentStr = allOrders
        .map(
          (o) =>
            `${o.reference}: ${o.paymentStatus === "PAID" ? "Paid" : "Unpaid"}`
        )
        .join(" | ");
    }
  }

  let statusStr = "";
  if (!isMerged) {
    statusStr = initialOrder.status;
  } else {
    const distinctStatuses = Array.from(new Set(allOrders.map((o) => o.status)));
    if (distinctStatuses.length === 1) {
      statusStr = distinctStatuses[0];
    } else {
      statusStr = allOrders.map((o) => `${o.reference}: ${o.status}`).join(" | ");
    }
  }

  let customerTypeStr = "";
  if (isMerged) {
    customerTypeStr = `Returning (Merged ${allOrders.length} orders)`;
  } else {
    customerTypeStr = initialOrder.isNewCustomer ? "New" : "Returning";
  }

  let orderedAtStr = "";
  if (!isMerged) {
    orderedAtStr = initialOrder.createdAt.toISOString();
  } else {
    orderedAtStr = `Initial: ${initialOrder.createdAt.toISOString()} | Follow-up: ${followingOrders
      .map((o) => `${o.reference} (${o.createdAt.toISOString()})`)
      .join(", ")}`;
  }

  let notesStr = "";
  if (!isMerged) {
    notesStr = initialOrder.notes ?? "";
  } else {
    notesStr = allOrders
      .filter((o) => o.notes)
      .map((o) => `[${o.reference}] ${o.notes}`)
      .join(" | ");
  }

  return [
    batchStr,
    referenceStr,
    instagramStr,
    customerName,
    itemsStr,
    totalSum,
    paymentStr,
    statusStr,
    customerTypeStr,
    orderedAtStr,
    notesStr,
  ];
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("orders.read", request);
    if (!guard.ok) return guard.response;
    const { searchParams } = new URL(request.url);
    const orders = await prisma.order.findMany({
      where: buildOrderWhere(searchParams),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        reference: true,
        status: true,
        paymentStatus: true,
        isNewCustomer: true,
        customerId: true,
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
    const canReadCustomer = hasPermission(guard.role, "customers.read");

    const TABLE_HEADERS = [
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
    ];

    const approvedOrders = orders.filter((o) => !isOrderCancelled(o.status));
    const cancelledOrders = orders.filter((o) => isOrderCancelled(o.status));

    const approvedGroups = groupOrdersByCustomer(approvedOrders);
    const cancelledGroups = groupOrdersByCustomer(cancelledOrders);

    const rows: (string | number | null)[][] = [];

    const emptyRow = Array(TABLE_HEADERS.length).fill("");
    const sectionRow = (title: string) => [
      title,
      ...Array(TABLE_HEADERS.length - 1).fill(""),
    ];

    rows.push(sectionRow("=== APPROVED / ACTIVE ORDERS ==="));
    rows.push(TABLE_HEADERS);
    if (approvedGroups.length > 0) {
      for (const group of approvedGroups) {
        rows.push(formatGroupRow(group, canReadCustomer));
      }
    } else {
      rows.push(sectionRow("(No approved orders)"));
    }

    rows.push(emptyRow);
    rows.push(emptyRow);

    rows.push(sectionRow("=== CANCELLED ORDERS ==="));
    rows.push(TABLE_HEADERS);
    if (cancelledGroups.length > 0) {
      for (const group of cancelledGroups) {
        rows.push(formatGroupRow(group, canReadCustomer));
      }
    } else {
      rows.push(sectionRow("(No cancelled orders)"));
    }

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