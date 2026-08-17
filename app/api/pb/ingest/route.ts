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
import {
  getEvidenceVerificationLabel,
  getVerifiedProviderSource,
  hasReliableProviderEvidence,
  type ReliablePriceEvidenceProduct,
} from "@/lib/price-ingest-evidence";

const VALID_SECTORS = [
  "construccion",
  "comercio_local",
  "estetica",
  "hosteleria",
  "automocion",
  "educacion",
];

interface IngestProduct extends ReliablePriceEvidenceProduct {
  name: string;
  unit?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  description?: string;
  price_basis?: string;
  price_scope?: string;
  observed_at?: string;
}

interface IngestBody {
  provider_name: string;
  sector: string;
  source_url?: string;
  products: IngestProduct[];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Error procesando el lote de precios";
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "pb-ingest",
    evidence_version: "official-sources-v2.2",
    verified_providers: [
      "ManoMano",
      "Leroy Merlin",
      "OBRAMAT",
      "Roca",
      "IKEA",
    ],
  });
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

  const verifiedProviderSource = getVerifiedProviderSource(provider_name);

  if (!provider) {
    const { data: newProvider, error: provErr } = await supabase
      .from("pb_providers")
      .insert({
        name: provider_name,
        legal_name: provider_name,
        website: verifiedProviderSource?.website || null,
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
  const isManoMano =
    provider_name.trim().toLocaleLowerCase("es") === "manomano";
  const isVerifiedProvider = Boolean(verifiedProviderSource);

  if (isVerifiedProvider) {
    const validProducts: IngestProduct[] = [];

    for (const p of products) {
      if (
        !p.name ||
        typeof p.price !== "number" ||
        !Number.isFinite(p.price) ||
        p.price <= 0
      ) {
        errors++;
        details.push({
          name: p.name || "??",
          action: "error",
          error: "name y price (>0 y finito) son obligatorios",
        });
        continue;
      }

      if (!hasReliableProviderEvidence(provider_name, p)) {
        errors++;
        details.push({
          name: p.name,
          action: "error",
          error:
            "Precio rechazado: faltan referencia o evidencias oficiales verificables",
        });
        continue;
      }

      validProducts.push(p);
    }

    if (validProducts.length > 0) {
      try {
        type ExistingProduct = {
          id: string;
          unit_price: number | string;
          sku: string | null;
          commercial_name: string;
        };

        const existingProducts: ExistingProduct[] = [];
        const skuChunks = chunkArray(
          Array.from(
            new Set(validProducts.map((product) => product.sku as string))
          ),
          100
        );

        const skuLookupResults = await Promise.all(
          skuChunks.map((skuChunk) =>
            supabase
              .from("pb_products")
              .select("id, unit_price, sku, commercial_name")
              .eq("provider_id", providerId)
              .eq("sector", sector)
              .in("sku", skuChunk)
          )
        );

        for (const lookup of skuLookupResults) {
          if (lookup.error) throw lookup.error;
          existingProducts.push(
            ...((lookup.data || []) as ExistingProduct[])
          );
        }

        const existingBySku = new Map(
          existingProducts
            .filter((product) => product.sku)
            .map((product) => [product.sku as string, product])
        );
        const changedRows: Array<Record<string, unknown>> = [];
        const unchangedRows: Array<Record<string, unknown>> = [];
        const newCandidates: IngestProduct[] = [];
        const observationProducts: Array<{
          product: IngestProduct;
          productId: string;
        }> = [];
        const claimedExistingIds = new Set<string>();
        const claimedNewSkus = new Set<string>();
        const syncedAt = new Date().toISOString();

        for (const product of validProducts) {
          const existing = existingBySku.get(product.sku as string);

          if (!existing) {
            const skuKey = product.sku as string;
            if (claimedNewSkus.has(skuKey)) {
              details.push({
                name: product.name,
                action: "unchanged",
              });
              continue;
            }
            claimedNewSkus.add(skuKey);
            newCandidates.push(product);
            continue;
          }

          if (claimedExistingIds.has(existing.id)) {
            details.push({
              name: product.name,
              action: "unchanged",
            });
            continue;
          }
          claimedExistingIds.add(existing.id);

          const oldPrice = Number(existing.unit_price);
          const newPrice = Number(product.price);
          const commonUpdate = {
            id: existing.id,
            provider_id: providerId,
            commercial_name: existing.commercial_name,
            sector,
            unit_price: newPrice,
            vat_rate: product.vat_rate ?? 21,
            sku: product.sku,
            source_url: product.product_url,
            last_synced_at: syncedAt,
          };

          if (Math.abs(oldPrice - newPrice) > 0.001) {
            changedRows.push({
              ...commonUpdate,
              price_trend: newPrice > oldPrice ? "up" : "down",
              is_active: true,
              is_available: true,
            });
            updated++;
            details.push({ name: product.name, action: "updated" });
          } else {
            unchangedRows.push(commonUpdate);
            details.push({ name: product.name, action: "unchanged" });
          }

          observationProducts.push({
            product,
            productId: existing.id,
          });
        }

        const changedPromise =
          changedRows.length > 0
            ? supabase
                .from("pb_products")
                .upsert(changedRows, { onConflict: "id" })
            : Promise.resolve({ error: null });
        const unchangedPromise =
          unchangedRows.length > 0
            ? supabase
                .from("pb_products")
                .upsert(unchangedRows, { onConflict: "id" })
            : Promise.resolve({ error: null });
        const insertPromise =
          newCandidates.length > 0
            ? supabase
                .from("pb_products")
                .insert(
                  newCandidates.map((product) => ({
                    commercial_name: product.name.trim(),
                    unit_price: product.price,
                    vat_rate: product.vat_rate ?? 21,
                    sale_unit: product.unit || "ud",
                    category: product.category || "material",
                    subcategory: product.subcategory || "",
                    brand: product.brand || null,
                    sku: product.sku,
                    description: product.description || "",
                    provider_id: providerId,
                    sector,
                    product_type: product.category || "material",
                    is_active: true,
                    is_available: true,
                    last_synced_at: syncedAt,
                    source_url: product.product_url,
                    price_trend: "stable",
                  }))
                )
                .select("id, sku, commercial_name")
            : Promise.resolve({
                data: [] as Array<{
                  id: string;
                  sku: string | null;
                  commercial_name: string;
                }>,
                error: null,
              });

        const [changedResult, unchangedResult, insertResult] =
          await Promise.all([
            changedPromise,
            unchangedPromise,
            insertPromise,
          ]);

        if (changedResult.error) throw changedResult.error;
        if (unchangedResult.error) throw unchangedResult.error;
        if (insertResult.error) throw insertResult.error;

        const insertedProducts = (insertResult.data || []) as Array<{
          id: string;
          sku: string | null;
          commercial_name: string;
        }>;
        const insertedBySku = new Map(
          insertedProducts
            .filter((product) => product.sku)
            .map((product) => [product.sku as string, product])
        );
        const insertedByName = new Map(
          insertedProducts.map((product) => [
            product.commercial_name,
            product,
          ])
        );

        for (const product of newCandidates) {
          const insertedProduct =
            insertedBySku.get(product.sku as string) ||
            insertedByName.get(product.name.trim());

          if (!insertedProduct) {
            throw new Error(
              `No se pudo confirmar el alta de ${product.name}`
            );
          }

          inserted++;
          details.push({ name: product.name, action: "inserted" });
          observationProducts.push({
            product,
            productId: insertedProduct.id,
          });
        }

        if (observationProducts.length > 0) {
          const { error: observationError } = await supabase
            .from("pb_price_observations")
            .insert(
              observationProducts.map(({ product, productId }) => ({
                product_id: productId,
                provider_id: providerId,
                observed_price: product.price,
                source:
                  product.evidence_type === "official_bc3_catalog"
                    ? "provider_catalog"
                    : "n8n",
                source_url: product.product_url,
                metadata: {
                  sku: product.sku,
                  brand: product.brand,
                  raw_price: product.raw_price,
                  product_url: product.product_url,
                  currency: product.currency || "EUR",
                  seller: product.seller,
                  price_basis: product.price_basis,
                  price_includes_vat: product.price_includes_vat,
                  vat_rate: product.vat_rate,
                  price_scope: product.price_scope,
                  observed_at: product.observed_at,
                  evidence_type: product.evidence_type,
                  manufacturer_reference: product.manufacturer_reference,
                  catalog_sha256: product.catalog_sha256,
                  catalog_published_at: product.catalog_published_at,
                  verification: getEvidenceVerificationLabel(provider_name),
                },
              }))
            );
          if (observationError) throw observationError;
        }
      } catch (err) {
        return NextResponse.json(
          {
            ok: false,
            error: getErrorMessage(err),
          },
          { status: 500 }
        );
      }
    }
  } else {
    for (const p of products) {
    try {
      if (
        !p.name ||
        typeof p.price !== "number" ||
        !Number.isFinite(p.price) ||
        p.price <= 0
      ) {
        errors++;
        details.push({
          name: p.name || "??",
          action: "error",
          error: "name y price (>0 y finito) son obligatorios",
        });
        continue;
      }

      if (isManoMano && !hasReliableProviderEvidence(provider_name, p)) {
        errors++;
        details.push({
          name: p.name,
          action: "error",
          error:
            "Precio rechazado: faltan SKU, URL de producto o etiqueta exacta en euros",
        });
        continue;
      }

      const productSourceUrl = p.product_url || source_url || null;
      const observationMetadata = {
        sku: p.sku,
        brand: p.brand,
        raw_price: p.raw_price,
        product_url: p.product_url,
        currency: p.currency,
        seller: p.seller,
        price_basis: p.price_basis,
        price_includes_vat: p.price_includes_vat,
        vat_rate: p.vat_rate,
        price_scope: p.price_scope,
        observed_at: p.observed_at,
        evidence_type: p.evidence_type,
        manufacturer_reference: p.manufacturer_reference,
        catalog_sha256: p.catalog_sha256,
        catalog_published_at: p.catalog_published_at,
        verification: isManoMano
          ? "sku_url_raw_price"
          : "provider_payload",
      };

      // ManoMano se identifica primero por SKU estable. El nombre solo se usa
      // como compatibilidad con productos históricos que aún no tenían SKU.
      let existing: { id: string; unit_price: number | string } | null = null;
      if (p.sku) {
        const { data: skuMatches, error: skuLookupError } = await supabase
          .from("pb_products")
          .select("id, unit_price")
          .eq("sku", p.sku)
          .eq("provider_id", providerId)
          .eq("sector", sector)
          .limit(1);
        if (skuLookupError) throw skuLookupError;
        existing = skuMatches?.[0] || null;
      }

      if (!existing) {
        const { data: nameMatches, error: nameLookupError } = await supabase
          .from("pb_products")
          .select("id, unit_price")
          .eq("commercial_name", p.name.trim())
          .eq("provider_id", providerId)
          .eq("sector", sector)
          .limit(1);
        if (nameLookupError) throw nameLookupError;
        existing = nameMatches?.[0] || null;
      }

      if (existing) {
        // Actualizar precio si cambió
        const oldPrice = Number(existing.unit_price);
        const newPrice = Number(p.price);

        const { error: observationError } = await supabase
          .from("pb_price_observations")
          .insert({
            product_id: existing.id,
            provider_id: providerId,
            observed_price: newPrice,
            source: "n8n",
            source_url: productSourceUrl,
            metadata: observationMetadata,
          });
        if (observationError) throw observationError;

        if (Math.abs(oldPrice - newPrice) > 0.001) {
          // Calcular tendencia
          const trend =
            newPrice > oldPrice ? "up" : newPrice < oldPrice ? "down" : "stable";

          const { error: updateError } = await supabase
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
              source_url: productSourceUrl || undefined,
              price_trend: trend,
              is_active: true,
              is_available: true,
            })
            .eq("id", existing.id);
          if (updateError) throw updateError;

          updated++;
          details.push({ name: p.name, action: "updated" });
        } else {
          // Precio igual, solo actualizar timestamp
          const { error: timestampError } = await supabase
            .from("pb_products")
            .update({
              last_synced_at: new Date().toISOString(),
              sku: p.sku || undefined,
              source_url: productSourceUrl || undefined,
            })
            .eq("id", existing.id);
          if (timestampError) throw timestampError;

          details.push({ name: p.name, action: "unchanged" });
        }
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
            source_url: productSourceUrl,
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
          const { error: observationError } = await supabase
            .from("pb_price_observations")
            .insert({
            product_id: newProduct.id,
            provider_id: providerId,
            observed_price: p.price,
            source: "n8n",
              source_url: productSourceUrl,
              metadata: observationMetadata,
            });
          if (observationError) throw observationError;
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
