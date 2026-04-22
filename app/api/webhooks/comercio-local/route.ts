import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { syncUserPrices } from "@/lib/services/price-sync";

// Usamos el Service Role Key para operaciones de webhook que necesitan saltarse RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// POST /api/webhooks/comercio-local - Endpoint exclusivo para n8n de comercio local
// n8n puede enviar actualizaciones de precios, normativas, etc.
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const webhookSecret = process.env.WEBHOOK_SECRET || "enlaze-n8n-2024";
    const agentApiKey = process.env.AGENT_API_KEY || "enlace_agentcomerciallocal_2026_9f3c7a1d5b8e2f4a6c1d9e7b3a5f2c12";

    if (authHeader !== "Bearer " + webhookSecret && authHeader !== "Bearer " + agentApiKey) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();

if (!body?.action) {
  return NextResponse.json({ error: "Falta el campo: action" }, { status: 400 });
}

const normalizedBody = {
  ...body,
  sector: body.sector ?? "comercio_local",
  service: body.service ?? "comercio_local",
  agent_id: body.agent_id ?? "agent_comercio_local_360",
};

if (normalizedBody.sector !== "comercio_local") {
  return NextResponse.json({ error: "Este webhook solo acepta el sector comercio_local" }, { status: 400 });
}



const { action, sector, data } = normalizedBody;

    // Log de la actualizacion
    await supabase.from("n8n_updates").insert({
      sector,
      update_type: action,
      data: normalizedBody,
      status: "processing",
    });

    switch (action) {
      case "update_prices": {
        // n8n envia precios actualizados del mercado
        if (!data?.prices || !Array.isArray(data.prices)) {
          return NextResponse.json({ error: "data.prices debe ser un array" }, { status: 400 });
        }

        // 1. Guardar en sector_data (registro maestro del mercado)
        for (const price of data.prices) {
          const { data: existing } = await supabase
            .from("sector_data")
            .select("id")
            .eq("sector", sector)
            .eq("data_type", "price")
            .eq("title", price.title)
            .single();

          if (existing) {
            await supabase
              .from("sector_data")
              .update({
                value: price.value,
                unit: price.unit || "ud",
                category: price.category || "",
                subcategory: price.subcategory || "",
                source: price.source || "n8n",
                description: price.description || "",
                last_updated: new Date().toISOString(),
                metadata: price.metadata || {},
              })
              .eq("id", existing.id);
          } else {
            await supabase.from("sector_data").insert({
              sector,
              data_type: "price",
              title: price.title,
              description: price.description || "",
              value: price.value,
              unit: price.unit || "ud",
              category: price.category || "",
              subcategory: price.subcategory || "",
              source: price.source || "n8n",
              metadata: price.metadata || {},
            });
          }
        }

        // 2. Broadcast: Actualizar bancos de precios de todos los usuarios activos del sector
        let usersProcessed = 0;
        let totalAdded = 0;
        let totalUpdated = 0;

        try {
          // Buscar usuarios activos del sector
          const { data: activeUsers } = await supabase
            .from("profiles")
            .select("id")
            .eq("business_sector", sector);

          if (activeUsers && activeUsers.length > 0) {
            const marketPrices = data.prices;
            
            // Ejecutar la sincronización para cada usuario
            for (const user of activeUsers) {
              try {
                const results = await syncUserPrices(supabase, user.id, sector, marketPrices, "n8n_workflow");
                usersProcessed++;
                totalAdded += results.added;
                totalUpdated += results.updated;
              } catch (userErr) {
                console.error(`Error sync user ${user.id}:`, userErr);
              }
            }
          }
        } catch (err) {
          console.error("Error broadcast users:", err);
        }

        // Marcar update como completado
        await supabase
          .from("n8n_updates")
          .update({ status: "completed", processed_at: new Date().toISOString() })
          .eq("sector", sector)
          .eq("status", "processing");

        return NextResponse.json({
          success: true,
          message: `${data.prices.length} precios actualizados en mercado. Broadcast a ${usersProcessed} usuarios (${totalAdded} nuevos, ${totalUpdated} act).`,
        });
      }

      case "update_regulations": {
        if (!data?.regulations || !Array.isArray(data.regulations)) {
          return NextResponse.json({ error: "data.regulations debe ser un array" }, { status: 400 });
        }

        for (const reg of data.regulations) {
          const { data: existing } = await supabase
            .from("sector_data")
            .select("id")
            .eq("sector", sector)
            .eq("data_type", "regulation")
            .eq("title", reg.title)
            .single();

          if (existing) {
            await supabase
              .from("sector_data")
              .update({
                description: reg.description || "",
                source: reg.source || "n8n",
                last_updated: new Date().toISOString(),
                metadata: reg.metadata || {},
              })
              .eq("id", existing.id);
          } else {
            await supabase.from("sector_data").insert({
              sector,
              data_type: "regulation",
              title: reg.title,
              description: reg.description || "",
              source: reg.source || "n8n",
              metadata: reg.metadata || {},
            });
          }
        }

        await supabase
          .from("n8n_updates")
          .update({ status: "completed", processed_at: new Date().toISOString() })
          .eq("sector", sector)
          .eq("status", "processing");

        return NextResponse.json({
          success: true,
          message: data.regulations.length + " normativas actualizadas para sector " + sector,
        });
      }

      case "update_news": {
        if (!data?.news) {
          return NextResponse.json({ error: "data.news requerido" }, { status: 400 });
        }

        await supabase.from("sector_data").insert({
          sector,
          data_type: "news",
          title: data.news.title || "Actualizacion",
          description: data.news.content || "",
          source: data.news.source || "n8n",
          metadata: data.news.metadata || {},
        });

        return NextResponse.json({ success: true, message: "Noticia anadida para sector " + sector });
      }

      default:
        return NextResponse.json({ error: "Accion no reconocida: " + action }, { status: 400 });
    }
  } catch (e: any) {
    console.error("Webhook error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET /api/webhook - Info del endpoint para n8n
export async function GET() {
  return NextResponse.json({
    name: "Enlaze Webhook API",
    version: "1.0",
    actions: ["update_prices", "update_regulations", "update_news"],
    auth: "Bearer token en header Authorization",
    example: {
      action: "update_prices",
      sector: "construccion",
      data: {
        prices: [
          { title: "Azulejo porcelanico 30x60", value: 19.50, unit: "m2", category: "material", source: "proveedor-x" }
        ]
      }
    }
  });
}

