/**
 * POST /api/pb/ingest
 *
 * Endpoint para que n8n (u otras herramientas) envíen precios scrapeados.
 * Autenticación vía Bearer token (SYNC_API_KEY en .env).
 *
 * Body JSON:
 * {
 *   "provider_name": "Leroy Merlin",
 *   "sector": "construccion",
 *   "source_url": "https://www.leroymerlin.es/...",
 *   "products": [
 *     {
 *       "name": "Cemento Portland CEM II 25kg",
 *       "price": 4.95,
 *       "unit": "saco",
 *       "category": "material",
 *       "subcategory": "cementos",
 *       "brand": "Lafarge",
 *       "sku": "LM-12345",
 *       "description": "Cemento gris multiusos"
 *     }
 *   ]
 * }
 *
 * Respuesta:
 * { "ok": true, "inserted": 15, "updated": 3, "errors": 0, "details": [...] }
 */
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import * as crypto from "crypto";

const VALID_SECTORS = [
  "construccion",
  "comercio_local",
  "estetica",
  "hosteleria",
  "automocion",
  "educacion",
];

interface IngestProduct {
  name: string;
  price: number;
  unit?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  sku?: string;
  description?: string;
}

interface IngestBody {
  provider_name: string;
  sector: string;
  source_url?: string;
  products: IngestProduct[];
}

export async function POST(request: Request) {
  // ── 1. Autenticación por Bearer token ──────────────────────────────
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return NextResponse.json(
      { error: "Se requiere Authorization: Bearer <SYNC_API_KEY>" },
      { status: 401 }
    );
  }

  // Verificar contra SYNC_API_KEY en .env (simple) o contra tabla sync_api_keys (avanzado)
  const envKey = process.env.SYNC_API_KEY;
  const agentKey = process.env.AGENT_API_KEY;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  const validStaticKeys = [envKey, agentKey, webhookSecret].filter(Boolean);

  let isAuthorized = validStaticKeys.includes(token);

  // Si no coincide con keys estáticas, verificar en tabla sync_api_keys
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (!isAuthorized) {
    const keyHash = crypto.createHash("sha256").update(token).digest("hex");
    const { data: apiKey } = await supabase
      .from("sync_api_keys")
      .select("id, is_active, permissions, sectors, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (apiKey) {
      // Verificar expiración
      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        return NextResponse.json({ error: "API key expirada" }, { status: 401 });
      }
      // Verificar permiso de ingest
      if (!apiKey.permissions?.includes("ingest")) {
        return NextResponse.json(
          { error: "API key sin permiso de ingest" },
          { status: 403 }
        );
      }
      isAuthorized = true;

      // Actualizar last_used_at
      await supabase
        .from("sync_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKey.id);
    }
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  // ── 2. Parsear y validar body ──────────────────────────────────────
  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON inválido en el body" },
      { status: 400 }
    );
  }

  const { provider_name, sector, source_url, products } = body;

  if (!provider_name || typeof provider_name !== "string") {
    return NextResponse.json(
      { error: "provider_name es obligatorio" },
      { status: 400 }
    );
  }

  if (!sector || !VALID_SECTORS.includes(sector)) {
    return NextResponse.json(
      { error: `sector debe ser uno de: ${VALID_SECTORS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!Array.isArray(products) || products.length === 0) {
    return NextResponse.json(
      { error: "products debe ser un array con al menos 1 elemento" },
      { status: 400 }
    );
  }

  if (products.length > 500) {
    return NextResponse.json(
      { error: "Máximo 500 productos por petición" },
      { status: 400 }
    );
  }

  // ── 3. Buscar o crear proveedor ────────────────────────────────────
  let { data: provider } = await supabase
    .from("pb_providers")
    .select("id")
    .eq("name", provider_name)
    .eq("sector", sector)
    .single();

  if (!provider) {
    const { data: newProvider, error: provErr } = await supabase
      .from("pb_providers")
      .insert({
        name: provider_name,
        legal_name: provider_name,
        country: "ES",
        is_active: true,
        sector,
      })
      .select("id")
      .single();

    if (provErr || !newProvider) {
      return NextResponse.json(
        { error: `Error creando proveedor: ${provErr?.message}` },
        { status: 500 }
      );
    }
    provider = newProvider;
  }

  const providerId = provider.id;

  // ── 4. Procesar productos: upsert + observación ───────────────────
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const details: Array<{ name: string; action: string; error?: string }> = [];

  for (const p of products) {
    try {
      if (!p.name || typeof p.price !== "number" || p.price < 0) {
        errors++;
        details.push({
          name: p.name || "??",
          action: "error",
          error: "name y price (>=0) son obligatorios",
        });
        continue;
      }

      // Buscar producto existente por nombre + proveedor + sector
      const { data: existing } = await supabase
        .from("pb_products")
        .select("id, unit_price")
        .eq("commercial_name", p.name.trim())
        .eq("provider_id", providerId)
        .eq("sector", sector)
        .single();

      if (existing) {
        // Actualizar precio si cambió
        const oldPrice = Number(existing.unit_price);
        const newPrice = Number(p.price);

        if (Math.abs(oldPrice - newPrice) > 0.001) {
          // Calcular tendencia
          const trend =
            newPrice > oldPrice ? "up" : newPrice < oldPrice ? "down" : "stable";

          await supabase
            .from("pb_products")
            .update({
              unit_price: newPrice,
              sale_unit: p.unit || undefined,
              brand: p.brand || undefined,
              description: p.description || undefined,
              sku: p.sku || undefined,
              category: p.category || undefined,
              subcategory: p.subcategory || undefined,
              last_synced_at: new Date().toISOString(),
              source_url: source_url || undefined,
              price_trend: trend,
              is_active: true,
              is_available: true,
            })
            .eq("id", existing.id);

          updated++;
          details.push({ name: p.name, action: "updated" });
        } else {
          // Precio igual, solo actualizar timestamp
          await supabase
            .from("pb_products")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", existing.id);

          details.push({ name: p.name, action: "unchanged" });
        }

        // Registrar observación de precio (historial)
        await supabase.from("pb_price_observations").insert({
          product_id: existing.id,
          provider_id: providerId,
          observed_price: p.price,
          source: "n8n",
          source_url: source_url || null,
          metadata: { sku: p.sku, brand: p.brand },
        });
      } else {
        // Producto nuevo → insertar
        const { data: newProduct, error: insertErr } = await supabase
          .from("pb_products")
          .insert({
            commercial_name: p.name.trim(),
            unit_price: p.price,
            sale_unit: p.unit || "ud",
            category: p.category || "material",
            subcategory: p.subcategory || "",
            brand: p.brand || null,
            sku: p.sku || null,
            description: p.description || "",
            provider_id: providerId,
            sector,
            product_type: p.category || "material",
            is_active: true,
            is_available: true,
            last_synced_at: new Date().toISOString(),
            source_url: source_url || null,
            price_trend: "stable",
          })
          .select("id")
          .single();

        if (insertErr) {
          errors++;
          details.push({
            name: p.name,
            action: "error",
            error: insertErr.message,
          });
          continue;
        }

        // Registrar primera observación
        if (newProduct) {
          await supabase.from("pb_price_observations").insert({
            product_id: newProduct.id,
            provider_id: providerId,
            observed_price: p.price,
            source: "n8n",
            source_url: source_url || null,
            metadata: { sku: p.sku, brand: p.brand },
          });
        }

        inserted++;
        details.push({ name: p.name, action: "inserted" });
      }
    } catch (err) {
      errors++;
      details.push({
        name: p.name || "??",
        action: "error",
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }

  // ── 5. Registrar en price_sync_logs ────────────────────────────────
  try {
    await supabase.from("price_sync_logs").insert({
      status: errors > 0 && inserted + updated === 0 ? "error" : "completed",
      sector,
      source: "n8n_ingest",
      provider_name,
      products_total: products.length,
      products_inserted: inserted,
      products_updated: updated,
      products_errors: errors,
      source_url: source_url || null,
      finished_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical: log table might not have all columns
  }

  return NextResponse.json({
    ok: true,
    provider_id: providerId,
    inserted,
    updated,
    unchanged: products.length - inserted - updated - errors,
    errors,
    total: products.length,
    details:
      details.length <= 50
        ? details
        : details.slice(0, 50).concat({
            name: `... y ${details.length - 50} más`,
            action: "truncated",
          }),
  });
}
