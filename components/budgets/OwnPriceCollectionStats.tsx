"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export function OwnPriceCollectionStats({ userId }: { userId: string }) {
  const [stats, setStats] = useState<{ saved: number; reused: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await createClient().rpc("get_user_price_collection_stats");
      if (cancelled) return;
      if (error) { setFailed(true); return; }
      setStats(data as { saved: number; reused: number });
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);
  if (failed) return <p role="status" className="mb-4 text-sm text-amber-700">No se han podido cargar los contadores de precios propios.</p>;
  if (!stats) return null;
  return <p role="status" className="mb-4 text-sm text-navy-600 dark:text-zinc-300">
    Precios recogidos en presupuestos: <strong>{stats.saved}</strong> · Reutilizaciones en otros presupuestos: <strong>{stats.reused}</strong>
    <span className="block text-xs">Desde el inicio de la recogida. Cada precio cuenta una vez por presupuesto posterior guardado.</span>
  </p>;
}
