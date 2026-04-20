import { SupabaseClient } from "@supabase/supabase-js";

export async function syncUserPrices(
  supabase: SupabaseClient,
  userId: string,
  sector: string,
  marketPrices: any[],
  syncSource: "n8n_workflow" | "manual" = "manual"
) {
  // 1. Insert into price_sync_logs
  const { data: logData, error: logError } = await supabase
    .from("price_sync_logs")
    .insert({
      user_id: userId,
      sync_source: syncSource,
      sector,
      status: "running",
      items_received: marketPrices.length,
    })
    .select("id")
    .single();

  if (logError) {
    console.error("[PriceSync] Error creating sync log:", logError);
  }
  const logId = logData?.id;

  let added = 0;
  let updated = 0;
  let skipped = 0;

  try {
    // 2. Get current price items for user
    const { data: currentItems } = await supabase
      .from("price_items")
      .select("name, is_manual_override")
      .eq("user_id", userId)
      .eq("sector", sector);

    const existingMap = new Map((currentItems || []).map((i) => [i.name.toLowerCase(), i]));

    // 3. Process each market price
    for (const mp of marketPrices) {
      const itemName = mp.title || "";
      if (!itemName) continue;
      let subcat = mp.subcategory || "Otros";
      if (subcat === "Fontaneria") subcat = "Fontanería";
      if (subcat === "Albanileria") subcat = "Albañilería";
      const priceValue = parseFloat(mp.value) || 0;
      if (priceValue <= 0) continue;

      const lowerName = itemName.toLowerCase();

      // Common fields from market payload
      const updateData: any = {
        unit_price: priceValue,
        description: `Precio de mercado \u00B7 ${mp.source || "n8n"} \u00B7 ${new Date(mp.last_updated || new Date()).toLocaleDateString("es-ES")}`,
        source_type: "n8n_sync",
        source_url: mp.source || null,
        confidence_score: mp.confidence_score ?? 0.7,
        captured_at: mp.captured_at || new Date().toISOString(),
      };

      // Retail specific fields via metadata (if present)
      if (mp.metadata) {
        if (mp.metadata.purchase_price !== undefined) updateData.purchase_price = mp.metadata.purchase_price;
        if (mp.metadata.recommended_sale_price !== undefined) updateData.recommended_sale_price = mp.metadata.recommended_sale_price;
        if (mp.metadata.gross_margin_pct !== undefined) updateData.gross_margin_pct = mp.metadata.gross_margin_pct;
        if (mp.metadata.supplier_name !== undefined) updateData.supplier_name = mp.metadata.supplier_name;
      }

      if (existingMap.has(lowerName)) {
        const existing = existingMap.get(lowerName)!;
        if (existing.is_manual_override) {
          skipped++;
          continue;
        }

        await supabase
          .from("price_items")
          .update(updateData)
          .ilike("name", itemName)
          .eq("user_id", userId)
          .eq("sector", sector)
          .eq("is_manual_override", false);
        
        updated++;
      } else {
        const insertData = {
          ...updateData,
          user_id: userId,
          sector: sector,
          name: itemName,
          category: mp.category || "producto",
          subcategory: subcat,
          unit: mp.unit || "ud",
        };

        const { error } = await supabase.from("price_items").insert(insertData);
        if (error) console.error("[PriceSync] Insert error:", itemName, error);
        else added++;
      }
    }

    // 4. Mark log as completed
    if (logId) {
      await supabase
        .from("price_sync_logs")
        .update({
          status: "completed",
          items_created: added,
          items_updated: updated,
          items_skipped: skipped,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }
  } catch (error) {
    console.error("[PriceSync] Error during sync:", error);
    if (logId) {
      await supabase
        .from("price_sync_logs")
        .update({
          status: "failed",
          errors: [{ error: String(error) }],
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }
    throw error;
  }

  return { added, updated, skipped };
}
