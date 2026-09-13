"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch("/api/admin/campaigns");
        const json = await res.json();
        if (res.ok) {
          setCampaigns(json.data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchCampaigns();
  }, []);

  return (
    <div>
      <div className="admin-page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Campaigns</span>
        <Link href="/admin/campaigns/new" className="btn btn-primary">
          + New Campaign
        </Link>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Status</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Products</th>
                <th>Orders</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "var(--space-8)" }}>Loading...</td></tr>
              ) : campaigns.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-neutral-500)" }}>No campaigns found</td></tr>
              ) : campaigns.map(campaign => (
                <tr key={campaign.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{campaign.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>{campaign.slug}</div>
                  </td>
                  <td>
                    <span className={`badge ${
                      campaign.status === 'OPEN' ? 'badge-open' :
                      campaign.status === 'SCHEDULED' ? 'badge-coming' : 'badge-closed'
                    }`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td>{campaign.startAt ? format(new Date(campaign.startAt), "MMM d, yyyy") : "—"}</td>
                  <td>{campaign.endAt ? format(new Date(campaign.endAt), "MMM d, yyyy") : "—"}</td>
                  <td>{campaign.products?.length || 0}</td>
                  <td>{campaign._count?.orders || 0}</td>
                  <td>
                    <Link href={`/preorder/${campaign.slug}`} target="_blank" className="btn btn-ghost btn-sm" style={{ marginRight: "4px" }}>
                      Preview
                    </Link>
                    <Link href={`/admin/campaigns/${campaign.id}/edit`} className="btn btn-ghost btn-sm" style={{ marginRight: "4px" }}>Edit</Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Copy shareable form link"
                      onClick={() => {
                        const url = `${window.location.origin}/preorder/${campaign.slug}`;
                        navigator.clipboard.writeText(url).then(() => alert(`Copied!\n${url}`));
                      }}
                    >📋 Copy Link</button>
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
