import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;

    if (!file || !userId) {
      return NextResponse.json({ error: "Archivo y userId requeridos" }, { status: 400 });
    }

    // Convertir archivo a base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp";

    // Enviar a Claude para OCR
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `Analiza esta factura y extrae los siguientes datos en formato JSON estricto. Si no encuentras algún dato, pon cadena vacía "".

Responde SOLO con el JSON, sin texto adicional:

{
  "supplier_name": "nombre del proveedor/empresa que emite la factura",
  "supplier_nif": "NIF/CIF del proveedor",
  "supplier_address": "dirección del proveedor",
  "invoice_number": "número de factura",
  "invoice_date": "fecha de factura en formato YYYY-MM-DD",
  "due_date": "fecha de vencimiento en formato YYYY-MM-DD o vacío",
  "base_amount": 0.00,
  "iva_percentage": 21,
  "iva_amount": 0.00,
  "irpf_percentage": 0,
  "irpf_amount": 0.00,
  "total_amount": 0.00,
  "category": "una de: material, servicio, suministro, alquiler, subcontrata, profesional, transporte, seguro, general",
  "payment_method": "efectivo, transferencia, tarjeta, domiciliacion, o vacío",
  "items": [
    {
      "description": "descripción del concepto",
      "quantity": 1,
      "unit_price": 0.00,
      "iva_percentage": 21,
      "subtotal": 0.00
    }
  ],
  "confidence": 0.95,
  "notes": "cualquier observación relevante"
}`,
            },
          ],
        },
      ],
    });

    // Parsear respuesta de Claude
    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    
    // Limpiar posibles backticks de markdown
    const cleanJson = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    let invoiceData;
    try {
      invoiceData = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json({ error: "No se pudo parsear la respuesta de Claude", raw: responseText }, { status: 422 });
    }

    // Subir imagen a Supabase Storage
    const fileName = `${userId}/${Date.now()}-${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(fileName, file, { contentType: file.type });

    let imageUrl = "";
    if (!uploadError && uploadData) {
      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
      imageUrl = urlData.publicUrl;
    }

    // Calcular trimestre fiscal
    const invoiceDate = invoiceData.invoice_date ? new Date(invoiceData.invoice_date) : new Date();
    const month = invoiceDate.getMonth() + 1;
    const quarter = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
    const fiscalYear = invoiceDate.getFullYear();

    // Guardar en Supabase
    const { data: invoice, error: insertError } = await supabase
      .from("invoices")
      .insert({
        user_id: userId,
        supplier_name: invoiceData.supplier_name || "",
        supplier_nif: invoiceData.supplier_nif || "",
        supplier_address: invoiceData.supplier_address || "",
        invoice_number: invoiceData.invoice_number || "",
        invoice_date: invoiceData.invoice_date || null,
        due_date: invoiceData.due_date || null,
        base_amount: invoiceData.base_amount || 0,
        iva_percentage: invoiceData.iva_percentage || 21,
        iva_amount: invoiceData.iva_amount || 0,
        irpf_percentage: invoiceData.irpf_percentage || 0,
        irpf_amount: invoiceData.irpf_amount || 0,
        total_amount: invoiceData.total_amount || 0,
        category: invoiceData.category || "general",
        payment_method: invoiceData.payment_method || "",
        image_url: imageUrl,
        ocr_raw_data: invoiceData,
        ocr_confidence: invoiceData.confidence || 0,
        notes: invoiceData.notes || "",
        quarter,
        fiscal_year: fiscalYear,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Error guardando factura", details: insertError.message }, { status: 500 });
    }

    // Guardar líneas de factura
    if (invoiceData.items && Array.isArray(invoiceData.items) && invoice) {
      const items = invoiceData.items.map((item: any, idx: number) => ({
        invoice_id: invoice.id,
        description: item.description || "",
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
        iva_percentage: item.iva_percentage || 21,
        subtotal: item.subtotal || 0,
        sort_order: idx,
      }));
      await supabase.from("invoice_items").insert(items);
    }

    return NextResponse.json({
      success: true,
      invoice,
      ocr_data: invoiceData,
      message: "Factura procesada correctamente",
    });
  } catch (err: any) {
    console.error("OCR Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
