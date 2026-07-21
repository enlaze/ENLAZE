import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// POST /api/prices/import — Import prices from CSV
// Expected CSV format: nombre,precio,unidad,tipo,categoria,subcategoria,proveedor,marca,descripcion
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const providerName = (formData.get("provider") as string) || "Importacion CSV";
    const sourceLabel = (formData.get("source") as string) || "csv_import";

    if (!file) {
      return NextResponse.json({ error: "No se envio ningun archivo" }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: "El archivo debe tener al menos una linea de cabecera y una de datos" }, { status: 400 });
    }

    // Parse header
    const sep = lines[0].includes(";") ? ";" : ",";
    const rawHeaders = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/["\s]/g, ""));

    // Map common header names to our fields
    const headerMap: Record<string, string> = {
      nombre: "nombre", name: "nombre", descripcion: "nombre", concepto: "nombre", material: "nombre",
      precio: "precio", price: "precio", coste: "precio", importe: "precio", valor: "precio",
      unidad: "unidad", unit: "unidad", ud: "unidad",
      tipo: "tipo", type: "tipo", product_type: "tipo",
      categoria: "categoria", category: "categoria", capitulo: "categoria",
      subcategoria: "subcategoria", subcategory: "subcategoria",
      proveedor: "proveedor", provider: "proveedor", supplier: "proveedor",
      marca: "marca", brand: "marca",
      desc: "descripcion", description: "descripcion",
    };

    const colIdx: Record<string, number> = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const mapped = headerMap[rawHeaders[i]];
      if (mapped && !(mapped in colIdx)) colIdx[mapped] = i;
    }

    if (!("nombre" in colIdx)) {
      return NextResponse.json({
        error: "No se encontro la columna 'nombre' o 'concepto'. Cabeceras detectadas: " + rawHeaders.join(", "),
      }, { status: 400 });
    }

    // Get or create provider (admin client for public provider)
    const supabaseAdmin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set() {},
          remove() {},
        },
      }
    );

    const { data: existingProv } = await supabaseAdmin
      .from("pb_providers")
      .select("id")
      .eq("name", providerName)
      .is("company_id", null)
      .limit(1);

    let providerId: string;
    if (existingProv && existingProv.length > 0) {
      providerId = existingProv[0].id;
    } else {
      const { data: newProv, error: provErr } = await supabaseAdmin
        .from("pb_providers")
        .insert({
          name: providerName,
          legal_name: providerName,
          country: "ES",
          is_active: true,
        })
        .select("id")
        .single();
      if (provErr || !newProv) {
        return NextResponse.json({ error: "Error creando proveedor: " + (provErr?.message || "unknown") }, { status: 500 });
      }
      providerId = newProv.id;
    }

    // Parse rows
    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], sep);
      const nombre = cols[colIdx.nombre]?.trim();
      if (!nombre) { skipped++; continue; }

      const precio = colIdx.precio !== undefined ? parseFloat(cols[colIdx.precio]?.replace(",", ".") || "0") : 0;
      if (isNaN(precio) || precio < 0) { skipped++; errors.push(`Linea ${i + 1}: precio invalido`); continue; }

      const unidad = cols[colIdx.unidad]?.trim() || "ud";
      const tipo = cols[colIdx.tipo]?.trim() || "material";
      const cat = cols[colIdx.categoria]?.trim() || "";
      const subcat = cols[colIdx.subcategoria]?.trim() || "";
      const marca = cols[colIdx.marca]?.trim() || null;
      const desc = cols[colIdx.descripcion]?.trim() || "";

      const { error: insErr } = await supabaseAdmin.from("pb_products").insert({
        provider_id: providerId,
        commercial_name: nombre,
        description: desc,
        sale_unit: unidad,
        unit_price: precio,
        brand: marca,
        product_type: tipo,
        category: cat,
        subcategory: subcat,
        region: "ES",
        is_active: true,
        is_available: true,
        checked_at: now,
      });

      if (insErr) {
        errors.push(`Linea ${i + 1}: ${insErr.message}`);
        skipped++;
      } else {
        imported++;
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: lines.length - 1,
      errors: errors.slice(0, 10),
      provider: providerName,
    });
  } catch (err: any) {
    console.error("[prices/import] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
