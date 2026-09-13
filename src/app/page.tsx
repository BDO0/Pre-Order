import Link from "next/link";
import styles from "./page.module.css";

interface Campaign {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  status: string;
  endAt: string | null;
}

async function getCampaigns(): Promise<Campaign[]> {
  try {
    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/campaigns`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const campaigns = await getCampaigns();

  return (
    <main className={styles.home}>
      <nav className="navbar">
        <div className="container navbar-inner">
          <span className="navbar-brand">ANA Clothing</span>
          <Link href="/order-status" className="btn btn-ghost btn-sm">
            Track Order
          </Link>
        </div>
      </nav>

      <div className={styles.hero}>
        <div className="container">
          <h1 className={styles.heroTitle}>ANA Clothing Pre-Order</h1>
          <p className={styles.heroSub}>
            Browse our current collections and place your pre-order below.
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingBlock: "var(--space-10)" }}>
        {campaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🛍️</div>
            <p className="empty-state-title">No Active Campaigns</p>
            <p className="empty-state-text">
              There are no open pre-orders right now. Check back soon!
            </p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, marginBottom: "var(--space-6)", color: "var(--color-neutral-800)" }}>
              Open Pre-Orders
            </h2>
            <div className="product-grid">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="card">
                  {campaign.coverImage && (
                    <div style={{ aspectRatio: "16/9", overflow: "hidden", borderRadius: "var(--radius-lg) var(--radius-lg) 0 0" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={campaign.coverImage}
                        alt={campaign.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  )}
                  <div className="card-body">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-2)" }}>
                      <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-neutral-900)" }}>
                        {campaign.name}
                      </h3>
                      <span className="badge badge-open">Open</span>
                    </div>
                    {campaign.description && (
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", marginBottom: "var(--space-4)" }}>
                        {campaign.description}
                      </p>
                    )}
                    {campaign.endAt && (
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)", marginBottom: "var(--space-4)" }}>
                        Closes: {new Date(campaign.endAt).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                    <Link
                      href={`/preorder/${campaign.slug}`}
                      className="btn btn-primary btn-full"
                    >
                      Shop Now →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

