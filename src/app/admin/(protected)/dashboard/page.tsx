import { prisma } from "@/lib/db";
import styles from "./dashboard.module.css";
import { format } from "date-fns";

async function getStats() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalOrders, todayOrders, pendingOrders, paymentReview,
    confirmedOrders, completedOrders, activeCampaigns,
    confirmedRevenue, grossValue, recentOrders,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "PAYMENT_REVIEW" } }),
    prisma.order.count({ where: { status: "CONFIRMED" } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.campaign.count({ where: { status: "OPEN" } }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { status: { in: ["CONFIRMED", "PROCESSING", "READY", "SHIPPED", "COMPLETED"] } },
    }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { status: { notIn: ["CANCELLED", "REJECTED"] } },
    }),
    prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { campaign: { select: { name: true } } },
    }),
  ]);

  return {
    totalOrders, todayOrders, pendingOrders, paymentReview,
    confirmedOrders, completedOrders, activeCampaigns,
    confirmedRevenue: confirmedRevenue._sum.total ?? 0,
    grossValue: grossValue._sum.total ?? 0,
    recentOrders,
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

  return (
    <div>
      <h1 className="admin-page-title">Dashboard</h1>

      {/* Stats Grid */}
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
          <p className="stat-label">Payment Review</p>
          <p className="stat-value" style={{ color: "var(--color-brand-500)" }}>{stats.paymentReview}</p>
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
          <p className="stat-label">Active Campaigns</p>
          <p className="stat-value">{stats.activeCampaigns}</p>
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

      {/* Recent Orders */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Orders</h2>
          <a href="/admin/orders" className="btn btn-secondary btn-sm">View All</a>
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Campaign</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--color-neutral-400)", padding: "var(--space-8)" }}>
                      No orders yet
                    </td>
                  </tr>
                ) : stats.recentOrders.map((order) => {
                  const snapshot = order.customerSnapshot as { fullName?: string };
                  return (
                    <tr key={order.id}>
                      <td style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>
                        {order.reference}
                        {order.isPossibleDuplicate && (
                          <span title="Possible duplicate" style={{ marginLeft: "var(--space-1)", color: "var(--color-warning)" }}>⚠</span>
                        )}
                      </td>
                      <td>{snapshot.fullName ?? "—"}</td>
                      <td>{order.campaign.name}</td>
                      <td style={{ fontWeight: 600 }}>₱{Number(order.total).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[order.status] ?? "badge-closed"}`}>
                          {order.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ color: "var(--color-neutral-500)", fontSize: "var(--text-xs)" }}>
                        {format(new Date(order.createdAt), "MMM d, h:mm a")}
                      </td>
                      <td>
                        <a href={`/admin/orders/${order.id}`} className="btn btn-ghost btn-sm">View</a>
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
