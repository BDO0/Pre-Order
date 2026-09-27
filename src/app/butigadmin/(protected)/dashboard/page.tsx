import { prisma } from "@/lib/db";
import Link from "next/link";
import styles from "./dashboard.module.css";
import { format } from "date-fns";
import { describeEta } from "@/lib/batches";
interface ActionItem {
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: "warn" | "info" | "success";
}
async function getStats() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const [
    statusGroups, todayOrders, activeBatches, recentOrders,
    unpaidOrders, unpaidNewCustomers, dueBatches,
  ] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.batch.count({ where: { status: "OPEN" } }),
    prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        batch: { select: { name: true } },
      },
    }),
    prisma.order.count({
      where: { paymentStatus: "UNPAID", status: { notIn: ["CANCELLED", "REJECTED"] } },
    }),
    prisma.order.count({
      where: {
        paymentStatus: "UNPAID",
        isNewCustomer: true,
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
    }),
    prisma.batch.findMany({
      where: {
        endAt: {
          not: null,
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        status: { not: "ARCHIVED" },
      },
      orderBy: { endAt: "asc" },
      select: { id: true, name: true, endAt: true, _count: { select: { orders: true } } },
    }),
  ]);
  let totalOrders = 0;
  let pendingOrders = 0;
  let paymentReview = 0;
  let confirmedOrders = 0;
  let completedOrders = 0;
  let confirmedRevenue = 0;
  let grossValue = 0;
  const confirmedStatuses = new Set(["CONFIRMED", "PROCESSING", "READY", "SHIPPED", "COMPLETED"]);
  const voidedStatuses = new Set(["CANCELLED", "REJECTED"]);
  for (const group of statusGroups) {
    const count = group._count.id;
    const sum = Number(group._sum.total ?? 0);
    totalOrders += count;
    if (group.status === "PENDING") pendingOrders = count;
    if (group.status === "PAYMENT_REVIEW") paymentReview = count;
    if (group.status === "CONFIRMED") confirmedOrders = count;
    if (group.status === "COMPLETED") completedOrders = count;
    if (confirmedStatuses.has(group.status)) {
      confirmedRevenue += sum;
    }
    if (!voidedStatuses.has(group.status)) {
      grossValue += sum;
    }
  }
  return {
    totalOrders, todayOrders, pendingOrders, paymentReview,
    confirmedOrders, completedOrders, activeBatches,
    confirmedRevenue,
    grossValue,
    recentOrders,
    unpaidOrders, unpaidNewCustomers, dueBatches,
  };
}
const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge-pending",
  AWAITING_PAYMENT: "badge-pending",
  PAYMENT_REVIEW: "badge-coming",
  CONFIRMED: "badge-confirmed",
  PROCESSING: "badge-confirmed",
  READY: "badge-confirmed",
  SHIPPED: "badge-confirmed",
  COMPLETED: "badge-completed",
  CANCELLED: "badge-cancelled",
  REJECTED: "badge-cancelled",
};
export default async function DashboardPage() {
  const stats = await getStats();
  const allActions: ActionItem[] = [
    {
      label: "New orders awaiting approval",
      detail: "New orders that nobody has looked at yet.",
      count: stats.pendingOrders,
      href: "/butigadmin/orders?status=PENDING",
      tone: "warn",
    },
    {
      label: "Unpaid Accepted Orders",
      detail: "Approved orders that have not yet been marked as paid.",
      count: stats.unpaidOrders,
      href: "/butigadmin/orders?status=CONFIRMED&paymentStatus=UNPAID",
      tone: "info",
    },
  ];
  const actions = allActions.filter((action) => action.count > 0);
  return (
    <div>
      <h1 className="admin-page-title">Dashboard</h1>
      <div className={styles.section} style={{ marginTop: 0 }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Needs your attention</h2>
        </div>
        {actions.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ textAlign: "center", padding: "var(--space-6)" }}>
              <p style={{ fontWeight: 600, color: "var(--color-success)", fontSize: "var(--text-base)" }}>All caught up</p>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-1)" }}>
                No orders currently require your attention.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="card"
                style={{
                  textDecoration: "none",
                  borderLeft: `4px solid ${
                    action.tone === "warn" ? "var(--color-warning)" : "var(--color-brand-400)"
                  }`,
                }}
              >
                <div
                  className="card-body"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}
                >
                  <div>
                    <p style={{ fontWeight: 700, color: "var(--color-neutral-900)" }}>{action.label}</p>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "2px" }}>
                      {action.detail}
                    </p>
                  </div>
                  <span
                    className={`badge ${action.tone === "warn" ? "badge-pending" : "badge-coming"}`}
                    style={{ fontSize: "var(--text-base)", padding: "var(--space-1) var(--space-3)", flexShrink: 0 }}
                  >
                    {action.count}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {stats.dueBatches.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Batches due</h2>
            <Link href="/butigadmin/batches" className="btn btn-secondary btn-sm">Manage batches</Link>
          </div>
          <div className="card">
            <div className="card-body">
              {stats.dueBatches.map((batch) => (
                <div
                  key={batch.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBlock: "var(--space-2)",
                    borderBottom: "1px solid var(--color-neutral-100)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{batch.name}</span>
                  <span style={{ color: "var(--color-neutral-500)" }}>
                    {batch._count.orders} order{batch._count.orders === 1 ? "" : "s"} ·{" "}
                    {describeEta(batch.endAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="stats-grid">
        <div className="stat-card">
          <p className="stat-label">Orders Today</p>
          <p className="stat-value">{stats.todayOrders}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Pending</p>
          <p className="stat-value" style={{ color: "var(--color-warning)" }}>{stats.pendingOrders}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Confirmed</p>
          <p className="stat-value" style={{ color: "var(--color-info)" }}>{stats.confirmedOrders}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Completed</p>
          <p className="stat-value" style={{ color: "var(--color-success)" }}>{stats.completedOrders}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Active Batches</p>
          <p className="stat-value">{stats.activeBatches}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Confirmed Revenue</p>
          <p className="stat-value" style={{ fontSize: "var(--text-xl)" }}>
            ₱{Number(stats.confirmedRevenue).toLocaleString()}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Gross Order Value</p>
          <p className="stat-value" style={{ fontSize: "var(--text-xl)", color: "var(--color-neutral-500)" }}>
            ₱{Number(stats.grossValue).toLocaleString()}
          </p>
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Orders</h2>
          <Link href="/butigadmin/orders" className="btn btn-secondary btn-sm">View All</Link>
        </div>
        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Order #</th>
                  <th>Batch</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", color: "var(--color-neutral-400)", padding: "var(--space-8)" }}>
                      No orders yet
                    </td>
                  </tr>
                ) : stats.recentOrders.map((order) => {
                  const snapshot = order.customerSnapshot as { fullName?: string };
                  return (
                    <tr key={order.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <Link
                            href={`/admin/orders/${order.id}`}
                            style={{
                              fontWeight: 700,
                              fontSize: "var(--text-base)",
                              color: "var(--color-neutral-900)",
                              textDecoration: "none",
                            }}
                          >
                            {snapshot.fullName ?? "—"}
                          </Link>
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "var(--text-xs)",
                            color: "var(--color-neutral-600)",
                            background: "var(--color-neutral-100)",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            fontWeight: 500,
                          }}
                        >
                          {order.reference}
                        </span>
                        {order.isPossibleDuplicate && (
                          <span title="Possible duplicate" style={{ marginLeft: "var(--space-1)", color: "var(--color-warning)", fontSize: "11px" }}>Duplicate</span>
                        )}
                      </td>
                      <td>
                        {}
                        {order.batch.name}
                      </td>
                      <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: order.paymentStatus === "PAID" ? "#dcfce7" : "#fee2e2",
                            color: order.paymentStatus === "PAID" ? "#14532d" : "#991b1b",
                            border: order.paymentStatus === "PAID" ? "1px solid #86efac" : "1px solid #fca5a5",
                            fontWeight: 700,
                            fontSize: "12px",
                            padding: "2px 8px",
                          }}
                        >
                          {order.paymentStatus === "PAID" ? "PAID" : "UNPAID"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[order.status] ?? "badge-closed"}`}>
                          {order.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ color: "var(--color-neutral-500)", fontSize: "var(--text-xs)" }}>
                        {format(new Date(order.createdAt), "MMM d, h:mm a")}
                      </td>
                      <td>
                        <Link href={`/admin/orders/${order.id}`} className="btn btn-ghost btn-sm">View</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
