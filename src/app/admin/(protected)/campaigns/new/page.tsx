"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    startAt: "",
    endAt: "",
    status: "OPEN",
    productIds: [] as string[],
  });

  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    // Fetch products to allow linking them to the campaign
    fetch("/api/admin/products?limit=100")
      .then(res => res.json())
      .then(json => setAvailableProducts(json.data.products || []))
      .catch(err => console.error("Failed to load products", err));
  }, []);

  const handleProductToggle = (id: string) => {
    setFormData(prev => ({
      ...prev,
      productIds: prev.productIds.includes(id) 
        ? prev.productIds.filter(pid => pid !== id)
        : [...prev.productIds, id]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (formData.productIds.length === 0) {
        throw new Error("Please select at least one product for the campaign.");
      }

      // 1. Upload image if exists
      let imageUrl = "";
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("file", imageFile);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadData });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error?.message || "Failed to upload image.");
        imageUrl = uploadJson.data.url;
      }

      // 2. Generate slug
      const slug = formData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      // 3. Create campaign
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          slug,
          description: formData.description,
          status: formData.status,
          startAt: formData.startAt ? new Date(formData.startAt).toISOString() : null,
          endAt: formData.endAt ? new Date(formData.endAt).toISOString() : null,
          coverImage: imageUrl || null,
          productIds: formData.productIds,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to create campaign");

      router.push("/admin/campaigns");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <Link href="/admin/campaigns" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", textDecoration: "none" }}>
          ← Back to Campaigns
        </Link>
        <h1 className="admin-page-title" style={{ marginTop: "var(--space-2)" }}>Create Campaign</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        {/* Left Column: Details */}
        <div className="card">
          <div className="card-body">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)" }}>Campaign Details</h2>
            <form id="campaignForm" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              
              <div className="form-group">
                <label className="form-label form-label-required">Campaign Name</label>
                <input required type="text" className="form-input" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. September Drop" />
              </div>

              <div className="form-group">
                <label className="form-label">Description (Optional)</label>
                <textarea className="form-input" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Write a short description..." rows={3} />
              </div>

              <div style={{ display: "flex", gap: "var(--space-4)" }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Start Date & Time (Optional)</label>
                  <input type="datetime-local" className="form-input" value={formData.startAt} onChange={e => setFormData({ ...formData, startAt: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">End Date & Time (Optional)</label>
                  <input type="datetime-local" className="form-input" value={formData.endAt} onChange={e => setFormData({ ...formData, endAt: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label form-label-required">Initial Status</label>
                <select required className="form-input" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                  <option value="DRAFT">Draft (Hidden)</option>
                  <option value="SCHEDULED">Scheduled (Visible, not open)</option>
                  <option value="OPEN">Open (Accepting pre-orders)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Cover Image</label>
                <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] || null)} className="form-input" style={{ padding: "var(--space-2)" }} />
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Products */}
        <div className="card">
          <div className="card-body">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-4)" }}>Select Products</h2>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", marginBottom: "var(--space-4)" }}>
              Choose which products are available to order in this campaign.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: "400px", overflowY: "auto" }}>
              {availableProducts.map(product => (
                <label key={product.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={formData.productIds.includes(product.id)}
                    onChange={() => handleProductToggle(product.id)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>₱{Number(product.price).toLocaleString()} • {product.category}</div>
                  </div>
                </label>
              ))}
              {availableProducts.length === 0 && (
                <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--color-neutral-500)", background: "var(--color-neutral-50)", borderRadius: "var(--radius-md)" }}>
                  No products available. Please create a product first.
                </div>
              )}
            </div>

            {error && <div className="form-error" style={{ marginTop: "var(--space-4)" }}>⚠ {error}</div>}

            <button type="submit" form="campaignForm" disabled={loading} className="btn btn-primary btn-full" style={{ marginTop: "var(--space-6)" }}>
              {loading ? "Creating..." : "Create Campaign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
