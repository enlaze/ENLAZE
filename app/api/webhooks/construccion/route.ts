import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  serviceRoleKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function throwIfSupabaseError(
  error: { message: string } | null,
  context: string
) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

async function markUpdate(
  updateId: string,
  status: "completed" | "failed"
) {
  const { error } = await supabaseAdmin
    .from("n8n_updates")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", updateId);

  throwIfSupabaseError(error, `No se pudo marcar la actualización como ${status}`);
}

// POST /api/webhooks/construccion - Endpoint exclusivo para n8n de construccion
// n8n puede enviar actualizaciones de precios, normativas, etc.
export async function POST(request: Request) {
  let updateId: string | null = null;

  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const validTokens = [
      process.env.WEBHOOK_SECRET,
      process.env.AGENT_API_KEY,
    ].filter(Boolean);

    if (!token || !validTokens.includes(token)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY no está configurada" },
        { status: 503 }
      );
    }

    const body = await request.json();

    if (!body?.action) {
      return NextResponse.json({ error: "Falta el campo: action" }, { status: 400 });
    }

    const normalizedBody = {
      ...body,
      sector: body.sector ?? "construccion",
      service: body.service ?? "construccion",
      agent_id: body.agent_id ?? "agent_construccion_360",
    };

    if (normalizedBody.sector !== "construccion") {
      return NextResponse.json({ error: "Este webhook solo acepta el sector construccion" }, { status: 400 });
    }

    const { action, sector, data } = normalizedBody;

    if (!["update_prices", "update_regulations", "update_news"].includes(action)) {
      return NextResponse.json(
        { error: "Accion no reconocida: " + action },
        { status: 400 }
      );
    }

    if (action === "update_prices" && !Array.isArray(data?.prices)) {
      return NextResponse.json(
        { error: "data.prices debe ser un array" },
        { status: 400 }
      );
    }

    if (action === "update_regulations" && !Array.isArray(data?.regulations)) {
      return NextResponse.json(
        { error: "data.regulations debe ser un array" },
        { status: 400 }
      );
    }

    if (action === "update_news" && !data?.news) {
      return NextResponse.json(
        { error: "data.news requerido" },
        { status: 400 }
      );
    }

    // Log de la actualizacion
    const { data: updateLog, error: updateLogError } = await supabaseAdmin
      .from("n8n_updates")
      .insert({
        sector,
        update_type: action,
        data: normalizedBody,
        status: "processing",
      })
      .select("id")
      .single();

    throwIfSupabaseError(updateLogError, "No se pudo crear el registro de n8n");
    updateId = updateLog?.id || null;

    if (!updateId) {
      throw new Error("Supabase no devolvió el ID del registro de n8n");
    }

    switch (action) {
      case "update_prices": {
        for (const price of data.prices) {
          if (
            !price ||
            typeof price.title !== "string" ||
            !price.title.trim() ||
            !Number.isFinite(Number(price.value))
          ) {
            throw new Error("Cada precio necesita title y value numérico");
          }

          // Buscar si ya existe
          const { data: existing, error: existingError } = await supabaseAdmin
            .from("sector_data")
            .select("id")
            .eq("sector", sector)
            .eq("data_type", "price")
            .eq("title", price.title)
            .maybeSingle();

          throwIfSupabaseError(existingError, `No se pudo consultar el precio ${price.title}`);

          const rawSource = [price.source, price.source_url, price.description, price.title, price.name].join(" ").toLowerCase();
          let supplierName = "Banco ENLAZE base";
          let sourceType = price.source_type === "default" ? "default" : "n8n_sync";

          if (rawSource.includes("leroy")) {
            supplierName = "Leroy Merlin";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("obramat") || rawSource.includes("bricomart")) {
            supplierName = "OBRAMAT";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("cype")) {
            supplierName = "CYPE / Banco de precios";
            sourceType = "banco_precios";
          } else if (rawSource.includes("referencia-mercado") || rawSource.includes("referencia")) {
            supplierName = "Referencia mercado";
            sourceType = "market_reference";
          } else if (rawSource.includes("bigmat")) {
            supplierName = "BigMat";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("porcelanosa")) {
            supplierName = "Porcelanosa";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("roca")) {
            supplierName = "Roca";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("bricoking")) {
            supplierName = "Bricoking";
            sourceType = "n8n_sync";
          } else if (rawSource.includes("bauhaus")) {
            supplierName = "Bauhaus";
            sourceType = "n8n_sync";
          } else if (price.source_type === "default") {
            supplierName = "Banco ENLAZE base";
          }

          if (existing) {
            const { error } = await supabaseAdmin
              .from("sector_data")
              .update({
                value: Number(price.value),
                unit: price.unit || "ud",
                category: price.category || "",
                subcategory: price.subcategory || "",
                source: price.source || "n8n",
                description: price.description || "",
                last_updated: new Date().toISOString(),
                metadata: {
                  ...(price.metadata || {}),
                  supplier_name: supplierName,
                  source_type: sourceType,
                },
              })
              .eq("id", existing.id);

            throwIfSupabaseError(error, `No se pudo actualizar el precio ${price.title}`);
          } else {
            const { error } = await supabaseAdmin
              .from("sector_data")
              .insert({
                sector,
                data_type: "price",
                title: price.title,
                description: price.description || "",
                value: Number(price.value),
                unit: price.unit || "ud",
                category: price.category || "",
                subcategory: price.subcategory || "",
                source: price.source || "n8n",
                metadata: {
                  ...(price.metadata || {}),
                  supplier_name: supplierName,
                  source_type: sourceType,
                },
              });

            throwIfSupabaseError(error, `No se pudo insertar el precio ${price.title}`);
          }
        }

        // Los índices INE y el PVPC son señales de mercado, no productos.
        const productPrices = data.prices.filter(
          (price: { category?: string }) =>
            !["energia", "indice_mercado"].includes(price.category || "")
        );
        if (productPrices.length > 0) {
          await bridgeToPriceBank(productPrices, data.source_group);
        }

        // ── Process price alerts (in-app + email notifications) ──
        await triggerAlertProcessing();

        await markUpdate(updateId, "completed");

        return NextResponse.json({
          success: true,
          message: data.prices.length + " precios actualizados para sector " + sector,
          update_id: updateId,
        });
      }

      case "update_regulations": {
        for (const reg of data.regulations) {
          if (!reg || typeof reg.title !== "string" || !reg.title.trim()) {
            throw new Error("Cada normativa necesita title");
          }

          const { data: existing, error: existingError } = await supabaseAdmin
            .from("sector_data")
            .select("id")
            .eq("sector", sector)
            .eq("data_type", "regulation")
            .eq("title", reg.title)
            .maybeSingle();

          throwIfSupabaseError(existingError, `No se pudo consultar la normativa ${reg.title}`);

          if (existing) {
            const { error } = await supabaseAdmin
              .from("sector_data")
              .update({
                description: reg.description || "",
                source: reg.source || "n8n",
                last_updated: new Date().toISOString(),
                metadata: reg.metadata || {},
              })
              .eq("id", existing.id);

            throwIfSupabaseError(error, `No se pudo actualizar la normativa ${reg.title}`);
          } else {
            const { error } = await supabaseAdmin
              .from("sector_data")
              .insert({
                sector,
                data_type: "regulation",
                title: reg.title,
                description: reg.description || "",
                source: reg.source || "n8n",
                metadata: reg.metadata || {},
              });

            throwIfSupabaseError(error, `No se pudo insertar la normativa ${reg.title}`);
          }
        }

        await markUpdate(updateId, "completed");

        return NextResponse.json({
          success: true,
          message: data.regulations.length + " normativas actualizadas para sector " + sector,
          update_id: updateId,
        });
      }

      case "update_news": {
        // Support both single news object and array
        const newsItems = Array.isArray(data.news) ? data.news : [data.news];

        for (const newsItem of newsItems) {
          if (
            !newsItem ||
            typeof newsItem.title !== "string" ||
            !newsItem.title.trim()
          ) {
            throw new Error("Cada noticia necesita title");
          }

          const { data: existing, error: existingError } = await supabaseAdmin
            .from("sector_data")
            .select("id")
            .eq("sector", sector)
            .eq("data_type", "news")
            .eq("title", newsItem.title)
            .maybeSingle();

          throwIfSupabaseError(existingError, `No se pudo consultar la noticia ${newsItem.title}`);

          const newsData = {
            description: newsItem.content || newsItem.description || "",
            source: newsItem.source || "n8n",
            metadata: newsItem.metadata || {},
            last_updated: new Date().toISOString(),
          };

          if (existing) {
            const { error } = await supabaseAdmin
              .from("sector_data")
              .update(newsData)
              .eq("id", existing.id);

            throwIfSupabaseError(error, `No se pudo actualizar la noticia ${newsItem.title}`);
          } else {
            const { error } = await supabaseAdmin.from("sector_data").insert({
              sector,
              data_type: "news",
              title: newsItem.title,
              ...newsData,
            });

            throwIfSupabaseError(error, `No se pudo insertar la noticia ${newsItem.title}`);
          }
        }

        await markUpdate(updateId, "completed");

        return NextResponse.json({
          success: true,
          message: newsItems.length + " noticias actualizadas para sector " + sector,
          update_id: updateId,
        });
      }

      default:
        return NextResponse.json({ error: "Accion no reconocida: " + action }, { status: 400 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Webhook error:", message);

    if (updateId) {
      try {
        await markUpdate(updateId, "failed");
      } catch (logError) {
        console.error(
          "No se pudo marcar la actualización como fallida:",
          logError instanceof Error ? logError.message : logError
        );
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Bridge: forward prices to Price Bank V2 tables ──────────────────────────

async function bridgeToPriceBank(
  prices: Array<{
    title?: string;
    name?: string;
    value?: number;
    unit?: string;
    source?: string;
    category?: string;
    subcategory?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }>,
  sourceGroup?: string
) {
  try {
    const now = new Date().toISOString();

    // Detect provider from source
    const detectProvider = (source: string, title: string) => {
      const txt = (source + " " + title).toLowerCase();
      if (txt.includes("leroy")) return "Leroy Merlin";
      if (txt.includes("obramat") || txt.includes("bricomart")) return "OBRAMAT";
      if (txt.includes("bigmat")) return "BigMat";
      if (txt.includes("porcelanosa")) return "Porcelanosa";
      if (txt.includes("roca")) return "Roca";
      if (txt.includes("cype")) return "CYPE";
      if (txt.includes("bricoking")) return "Bricoking";
      if (txt.includes("bauhaus")) return "Bauhaus";
      return "Mercado ES";
    };

    // Group prices by provider
    const byProvider = new Map<string, typeof prices>();
    for (const p of prices) {
      const provName = detectProvider(p.source || "", p.title || p.name || "");
      if (!byProvider.has(provName)) byProvider.set(provName, []);
      byProvider.get(provName)!.push(p);
    }

    for (const [provName, items] of byProvider) {
      // Get or create provider
      const { data: existingProv } = await supabaseAdmin
        .from("pb_providers")
        .select("id")
        .eq("name", provName)
        .is("company_id", null)
        .limit(1);

      let providerId: string;
      if (existingProv && existingProv.length > 0) {
        providerId = existingProv[0].id;
      } else {
        const { data: newProv } = await supabaseAdmin
          .from("pb_providers")
          .insert({
            name: provName,
            legal_name: provName,
            country: "ES",
            is_active: true,
          })
          .select("id")
          .single();
        if (!newProv) continue;
        providerId = newProv.id;
      }

      // Get or create source
      const sourceName = sourceGroup || "n8n-construccion-scraper";
      const { data: existingSrc } = await supabaseAdmin
        .from("pb_price_sources")
        .select("id")
        .eq("name", sourceName)
        .eq("provider_id", providerId)
        .limit(1);

      let sourceId: string;
      if (existingSrc && existingSrc.length > 0) {
        sourceId = existingSrc[0].id;
        await supabaseAdmin
          .from("pb_price_sources")
          .update({ last_checked_at: now, last_success_at: now })
          .eq("id", sourceId);
      } else {
        const { data: newSrc } = await supabaseAdmin
          .from("pb_price_sources")
          .insert({
            name: sourceName,
            source_type: "n8n_webhook",
            provider_id: providerId,
            country: "ES",
            update_frequency: "daily",
            last_checked_at: now,
            last_success_at: now,
            status: "active",
            is_active: true,
          })
          .select("id")
          .single();
        if (!newSrc) continue;
        sourceId = newSrc.id;
      }

      // Upsert products
      for (const item of items) {
        const productName = item.title || item.name || "";
        if (!productName) continue;
        const price = item.value ?? 0;

        const { data: existingProd } = await supabaseAdmin
          .from("pb_products")
          .select("id, unit_price")
          .eq("provider_id", providerId)
          .eq("commercial_name", productName)
          .limit(1);

        if (existingProd && existingProd.length > 0) {
          await supabaseAdmin
            .from("pb_products")
            .update({
              unit_price: price,
              sale_unit: item.unit || "ud",
              checked_at: now,
              is_available: true,
            })
            .eq("id", existingProd[0].id);
        } else {
          await supabaseAdmin
            .from("pb_products")
            .insert({
              provider_id: providerId,
              commercial_name: productName,
              description: item.description || "",
              sale_unit: item.unit || "ud",
              unit_price: price,
              region: "ES",
              is_available: true,
              checked_at: now,
              is_active: true,
            });
        }
      }
    }
  } catch (err) {
    // Don't fail the main webhook if PB bridge fails
    console.error("[PB Bridge] Error:", err instanceof Error ? err.message : err);
  }
}

// ── Trigger price alert processing after sync ──────────────────────────────
async function triggerAlertProcessing() {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    await fetch(`${baseUrl}/api/prices/process-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "webhook" }),
    });
  } catch (err) {
    console.error("[Webhook] Alert processing failed:", err instanceof Error ? err.message : err);
  }
}

// GET /api/webhooks/construccion - Info del endpoint para n8n
export async function GET() {
  return NextResponse.json({
    name: "Enlaze Webhook API - Construccion",
    version: "1.1",
    actions: ["update_prices", "update_regulations", "update_news"],
    auth: "Bearer token en header Authorization",
    note: "Los precios se guardan tanto en sector_data como en Price Bank V2 (pb_products)",
    example: {
      action: "update_prices",
      sector: "construccion",
      data: {
        prices: [
          { title: "Azulejo porcelanico 30x60", value: 19.50, unit: "m2", category: "material", source: "leroy-merlin" }
        ]
      }
    }
  });
}
