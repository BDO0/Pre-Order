"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    startAt: "",
    endAt: "",
    status: "OPEN",
    productIds: [] as string[],
  });

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [campaignRes, productsRes] = await Promise.all([
          fetch(`/api/admin/campaigns/${id}`),
          fetch("/api/admin/products?limit=100"),
        ]);

        const campaignJson = await campaignRes.json();
        const productsJson = await productsRes.json();

        if (!campaignRes.ok) throw new Error(campaignJson.error?.message || "Failed to load campaign");

        const c = campaignJson.data;
        setFormData({
          name: c.name,
          description: c.description || "",
          startAt: c.startAt ? new Date(c.startAt).toISOString().slice(0, 16) : "",
          endAt: c.endAt ? new Date(c.endAt).toISOString().slice(0, 16) : "",
          status: c.status,
          productIds: (c.products || []).map((cp: any) => cp.productId || cp.product?.id || cp.id),
        });

        setAvailableProducts(productsJson.data?.products || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };
    fetchAll();
  }, [id]);

  const handleProductToggle = (pid: string) => {
    setFormData(prev => ({
      ...prev,
      productIds: prev.productIds.includes(pid)
        ? prev.productIds.filter(p => p !== pid)
        : [...prev.productIds, pid],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          status: formData.status,
          startAt: formData.startAt ? new Date(formData.startAt).toISOString() : null,
          endAt: formData.endAt ? new Date(formData.endAt).toISOString() : null,
          productIds: formData.productIds,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update campaign");

      setSuccess("Campaign updated successfully!");
      setTimeout(() => router.push("/admin/campaigns"), 1200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-16)", color: "var(--color-neutral-500)" }}>
        Loading campaign...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link href="/admin/campaigns" style={{ fontSize: "var(--text-sm)", color: "var(--color-brand-600)", textDecoration: "none", fontWeight: 500 }}>
          ← Back to Campaigns
        </Link>
        <h1 className="admin-page-title" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
          Edit Campaign
        </h1>
      </div>

      {error && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(220 38 38 / 0.08)", border: "1px solid rgb(220 38 38 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-error)", marginBottom: "var(--space-4)", fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}
      {success && (
        <div style={{ padding: "var(--space-3) var(--space-4)", background: "rgb(22 163 74 / 0.08)", border: "1px solid rgb(22 163 74 / 0.3)", borderRadius: "var(--radius-lg)", color: "var(--color-success)", marginBottom: "var(--space-4)", fontWeight: 500 }}>
          ✓ {success}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        {/* Left: Campaign details */}
        <div className="card">
          <div className="card-body">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)", color: "var(--color-brand-700)" }}>Campaign Details</h2>
            <form id="editCampaignForm" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

              <div className="form-group">
                <label className="form-label form-label-required">Campaign Name</label>
                <input required type="text" className="form-input" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. September Drop" />
              </div>

              <div className="form-group">
                <label className="form-label">Description (Optional)</label>
                <textarea className="form-input" value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Short description for customers..." rows={3}
                  style={{ resize: "vertical", minHeight: "80px" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                <div className="form-group">
                  <label className="form-label">Start Date (Optional)</label>
                  <input type="datetime-local" className="form-input" value={formData.startAt}
                    onChange={e => setFormData({ ...formData, startAt: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date (Optional)</label>
                  <input type="datetime-local" className="form-input" value={formData.endAt}
                    onChange={e => setFormData({ ...formData, endAt: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label form-label-required">Status</label>
                <select required className="form-input" value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}>
                  <option value="DRAFT">Draft — Hidden, not visible to customers</option>
                  <option value="OPEN">Open — Customers can submit pre-orders</option>
                  <option value="CLOSED">Closed — No more pre-orders accepted</option>
                  <option value="ARCHIVED">Archived — Fully closed</option>
                </select>
              </div>
            </form>
          </div>
        </div>

        {/* Right: Products */}
        <div className="card">
          <div className="card-body">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-brand-700)" }}>
              Products in this Campaign
            </h2>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-4)" }}>
              Select which products customers can choose from.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: "350px", overflowY: "auto" }}>
              {availableProducts.map(product => (
                <label key={product.id} style={{
                  display: "flex", alignItems: "center", gap: "var(--space-3)",
                  padding: "var(--space-3)", borderRadius: "var(--radius-lg)", cursor: "pointer",
                  border: `2px solid ${formData.productIds.includes(product.id) ? "var(--color-brand-500)" : "var(--color-neutral-200)"}`,
                  background: formData.productIds.includes(product.id) ? "rgb(128 0 32 / 0.05)" : "white",
                  transition: "all 150ms ease",
                }}>
                  <input
                    type="checkbox"
                    checked={formData.productIds.includes(product.id)}
                    onChange={() => handleProductToggle(product.id)}
                    style={{ width: "18px", height: "18px", accentColor: "var(--color-brand-500)", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{product.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
                      ₱{Number(product.price).toLocaleString()} · {product.category || "No category"} · {product.variants?.length || 0} variant(s)
                    </div>
                  </div>
                </label>
              ))}
              {availableProducts.length === 0 && (
                <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--color-neutral-500)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-lg)", fontSize: "var(--text-sm)" }}>
                  No products yet. <Link href="/admin/products/new" style={{ color: "var(--color-brand-600)", fontWeight: 600 }}>Add a product</Link> first.
                </div>
              )}
            </div>

            <div style={{ marginTop: "var(--space-6)", display: "flex", gap: "var(--space-3)" }}>
              <Link href="/admin/campaigns" className="btn btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</Link>
              <button
                type="submit"
                form="editCampaignForm"
                disabled={loading}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Shareable link section */}
      <div className="card" style={{ marginTop: "var(--space-6)" }}>
        <div className="card-body">
          <h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-neutral-700)" }}>
            📎 Customer Pre-Order Link
          </h2>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginBottom: "var(--space-3)" }}>
            Share this link with customers. They will only see the products you have selected above.
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
            <div style={{
              flex: 1, padding: "var(--space-3) var(--space-4)", background: "var(--color-neutral-50)",
              border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-lg)",
              fontSize: "var(--text-sm)", color: "var(--color-brand-700)", fontFamily: "monospace", fontWeight: 600
            }}>
              {typeof window !== "undefined" ? `${window.location.origin}/preorder/` : ""}{"{campaign-slug}"}
            </div>
            <Link href="/admin/campaigns" className="btn btn-ghost btn-sm">
              View Campaigns for Link
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
