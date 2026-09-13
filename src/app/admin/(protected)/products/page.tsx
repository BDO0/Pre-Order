"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/admin/products");
        const json = await res.json();
        if (res.ok) {
          setProducts(json.data.products);
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
        <Link href="/admin/products/new" className="btn btn-primary">
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
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>No products found</td></tr>
              ) : products.map(product => (
                <tr key={product.id}>
                  <td style={{ width: "60px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-sm)", background: "var(--color-neutral-100)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {product.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
                      ) : "👗"}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{product.slug}</div>
                  </td>
                  <td>{product.category || "—"}</td>
                  <td>₱{Number(product.price).toLocaleString()}</td>
                  <td>{product.variants?.length || 0} variants</td>
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
                    <Link href={`/admin/products/${product.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
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
