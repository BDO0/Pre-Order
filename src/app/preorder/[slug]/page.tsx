import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CampaignPageClient from "./CampaignPageClient";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/campaigns/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return { title: "Campaign Not Found" };
    const { data } = await res.json();
    return {
      title: `${data.name} — Pre-Order Now`,
      description: data.description ?? `Pre-order the ${data.name} collection from ANA Clothing.`,
      openGraph: {
        title: `${data.name} — Pre-Order Now`,
        description: data.description ?? `Pre-order the ${data.name} collection from ANA Clothing.`,
        images: data.coverImage ? [{ url: data.coverImage }] : [],
        type: "website",
      },
    };
  } catch {
    return { title: "Pre-Order" };
  }
}

export default async function CampaignPage({ params }: Props) {
  const { slug } = await params;
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";

  let campaignData = null;
  try {
    const res = await fetch(`${baseUrl}/api/campaigns/${slug}`, { next: { revalidate: 30 } });
    if (res.ok) {
      const json = await res.json();
      campaignData = json.data;
    }
  } catch {
    // fall through to notFound
  }

  if (!campaignData) notFound();

  return <CampaignPageClient campaign={campaignData} />;
}
