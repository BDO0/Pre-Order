"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { variantCountLabel, stockSummary } from "@/lib/variant-stock";
import { parseApiResponse } from "@/lib/api-client";

/**
 * A row of the catalogue table, as `/api/admin/products` returns it.
 *
 * Only the columns this table renders are named: the endpoint also sends every
 * other product column, and inventing fields here that nothing reads would make
 * the type drift away from what is actually used.
 */
interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  /** Prisma `Decimal` arrives as a string over JSON; rendered through `Number()`. */
  price: string | number;
  images: string[];
  /**
   * Every variant row, retired ones included — the endpoint does not filter them.
   * `stockSummary` and `activeVariantCount` are what decide which of them count.
   */
  variants?: {
    id: string;
    active?: boolean;
    capacity?: number | null;
    remainingCapacity?: number | null;
  }[];
  active: boolean;
  preorderStatus: string;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/admin/products");
        const { ok, data } = await parseApiResponse(res);
        if (ok && data) {
          setProducts(data.products);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  return (
    <div>
      <div className="admin-page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Products</span>
        <Link href="/butigadmin/products/new" className="btn btn-primary">
          + New Product
        </Link>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Base Price</th>
                <th>Variants</th>
                <th>Stock Left</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>No products found</td></tr>
              ) : products.map(product => (
                <tr key={product.id}>
                  <td style={{ width: "60px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-sm)", background: "var(--color-neutral-100)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {product.images?.[0] ? (
                        <img src={product.images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
                      ) : (
                        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-neutral-400)" }}>IMG</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{product.slug}</div>
                  </td>
                  <td>{product.category || "—"}</td>
                  <td>₱{Number(product.price).toLocaleString()}</td>
                  <td>
                    {/* Live variants, not rows: retired variants are kept for their
                        order history and would otherwise be counted as sellable. */}
                    {variantCountLabel(product.variants)}
                  </td>
                  <td>{stockSummary(product.variants)}</td>
                  <td>
                    <span className={`badge ${product.active ? 'badge-open' : 'badge-closed'}`}>
                      {product.active ? "Active" : "Inactive"}
                    </span>
                    <span className={`badge ${
                      product.preorderStatus === 'OPEN' ? 'badge-open' :
                      product.preorderStatus === 'COMING_SOON' ? 'badge-coming' :
                      product.preorderStatus === 'SOLD_OUT' ? 'badge-sold-out' : 'badge-closed'
                    }`} style={{ marginLeft: "4px" }}>
                      PO {product.preorderStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                      <Link href={`/preorder/${product.slug}`} target="_blank" className="btn btn-ghost btn-sm" title="View from customer POV">
                        Preview
                      </Link>
                      <Link href={`/admin/products/${product.id}/edit`} className="btn btn-ghost btn-sm">
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Copy customer link"
                        onClick={() => {
                          const url = `${window.location.origin}/preorder/${product.slug}`;
                          navigator.clipboard.writeText(url).then(() => alert(`Customer link copied:\n${url}`));
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
