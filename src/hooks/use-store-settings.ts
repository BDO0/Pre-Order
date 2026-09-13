"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SHIPPING_FEE } from "@/lib/pricing";

/**
 * Reads the public store settings (currently the delivery fee) so the cart and
 * the checkout summary show the same number the server will charge.
 *
 * The initial state is the server's own fallback, so the worst case is a brief
 * flash of the standard fee before the real value arrives. It is never able to
 * produce a wrong total, because the authoritative figure is computed
 * server-side in the order service — this is display only.
 */
export function useStoreSettings() {
  const [shippingFee, setShippingFee] = useState<number>(DEFAULT_SHIPPING_FEE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/settings/public")
      .then((response) => response.json())
      .then((json) => {
        if (cancelled) return;
        if (typeof json?.data?.shippingFee === "number") {
          setShippingFee(json.data.shippingFee);
        }
      })
      .catch(() => {
        // Keep the fallback: a settings blip must not block the cart.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { shippingFee, loading };
}
