import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient, serviceRoleUnavailable } from "@/lib/supabase-service-role";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { logAiRun, hashText } from "@/lib/ai-logger";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { randomUUID } from "crypto";
import {
  RETAINED_INVOICE_BUCKET,
  buildConfirmedInvoiceDocument,
  parseOwnedOcrDraftUrl,
  retainedInvoiceStorageUrl,
} from "@/lib/invoice-ocr-drafts";
import { beginAccountWriteLease, endAccountWriteLease } from "@/lib/account-write-lease";
import { requireWriteAccess, reserveUsage } from "@/lib/subscription";

// Vision OCR + image processing + Storage round-trips can run long; the
// lease TTL below (180s) must stay comfortably above this.
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OCR_MODEL =
  process.env.ANTHROPIC_OCR_MODEL?.trim() || "claude-sonnet-4-6";

async function prepareImageForClaude(file: File) {
  const inputBuffer = Buffer.from(await file.arrayBuffer());

  const base = sharp(inputBuffer, { failOn: "none" }).rotate();
  const meta = await base.metadata();

  const width = meta.width || 1600;
  const height = meta.height || 1600;

  const maxEdge = 1568;
  const scale = Math.min(1, maxEdge / Math.max(width, height));

  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));

  let quality = 80;

  let output = await base
    .resize(resizedWidth, resizedHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (output.length > 4_500_000 && quality > 40) {
    quality -= 10;
    output = await sharp(output)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  if (output.length > 5_000_000) {
    output = await sharp(output)
      .resize(1200, 1200, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
  }

  if (output.length > 5_000_000) {
    throw new Error("La imagen sigue superando el límite de 5 MB tras comprimirla");
  }

  return {
    mediaType: "image/jpeg",
    base64: output.toString("base64"),
    bytes: output.length,
  };
}

// Storage uploads use the service client (cross-bucket access). Each handler
// gets it with getServiceRoleClient() and fails with 500 when it is missing:
// there is no anon-key fallback.

export async function POST(request: Request) {
  try {
    // Rate limit: 10 OCR requests per minute
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429 }
      );
    }

    const supabaseService = getServiceRoleClient();
    if (!supabaseService) return serviceRoleUnavailable("invoices/ocr");

    // Authenticate user from session
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Muro de pago: la cuenta en solo lectura no crea ni modifica.
    const blocked = await requireWriteAccess(user.id);
    if (blocked) return blocked;

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = user.id; // Use authenticated user, ignore client-sent userId
    if (formData.get("mode") !== "extract") {
      return NextResponse.json(
        { error: "Modo no admitido. Usa mode=extract y registra la factura revisada en Facturación → Recibidas." },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    if (file.size > 12_000_000) {
      return NextResponse.json(
        { error: "La imagen original es demasiado grande. Sube una foto más ligera o un PDF." },
        { status: 400 }
      );
    }

    // Muro de pago: cada escaneo con IA gasta cupo de "escaneos_ocr" (facturas
    // de proveedor), no de "facturas" (emitidas).
    const quota = await reserveUsage(user.id, "escaneos_ocr", 1, { source: "api:invoices/ocr" });
    if (quota) return quota;

    const preparedImage = await prepareImageForClaude(file);
    const startTime = Date.now();
    // Enviar a Claude para OCR
    const message = await anthropic.messages.create({
      model: OCR_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: preparedImage.base64 },
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

    // All OCR drafts belong to received_invoices and use retained, private storage.
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${Date.now()}-${randomUUID()}-${sanitizedFileName}`;
    const fileName = `${userId}/drafts/${objectName}`;
    const storageBucket = RETAINED_INVOICE_BUCKET;

    let uploadLeaseId: string;
    try {
      uploadLeaseId = await beginAccountWriteLease(supabaseService, userId, 180);
    } catch (lockErr) {
      return NextResponse.json(
        {
          error:
            lockErr instanceof Error
              ? lockErr.message
              : "No se pudo iniciar la subida del documento.",
        },
        { status: 409 }
      );
    }
    let uploadData: { path: string } | null = null;
    let uploadError: { message: string } | null = null;
    try {
      const result = await supabaseService.storage
        .from(storageBucket)
        .upload(fileName, file, {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
      uploadData = result.data;
      uploadError = result.error;
    } finally {
      await endAccountWriteLease(supabaseService, uploadLeaseId);
    }

    if (uploadError || !uploadData) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "No se pudo conservar el documento original de la factura." },
        { status: 500 }
      );
    }
    const imageUrl = retainedInvoiceStorageUrl(uploadData.path);

    const durationMs = Date.now() - startTime;
    logAiRun(supabase, {
      run_type: "ocr_invoice",
      model: OCR_MODEL,
      prompt_version: "v1.0",
      input_hash: await hashText(file.name + file.size),
      output_hash: await hashText(responseText),
      tokens_in: message.usage?.input_tokens,
      tokens_out: message.usage?.output_tokens,
      duration_ms: durationMs,
      entity_type: "received_invoice_draft",
    });

    return NextResponse.json({
      success: true,
      ocr_data: invoiceData,
      image_url: imageUrl,
      message: "Datos extraídos. Revisa la factura antes de guardarla.",
    });
  } catch (err: unknown) {
    console.error("OCR Error:", err);
    if (err instanceof Anthropic.NotFoundError) {
      return NextResponse.json(
        {
          error:
            "El servicio de lectura de facturas necesitaba una actualización. Ya puedes volver a intentarlo.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "No se pudo analizar la factura",
      },
      { status: 500 }
    );
  }
}

async function retainedObjectExists(
  supabaseService: SupabaseClient,
  objectPath: string,
): Promise<boolean> {
  const separator = objectPath.lastIndexOf("/");
  const directory = objectPath.slice(0, separator);
  const fileName = objectPath.slice(separator + 1);
  const { data, error } = await supabaseService.storage
    .from(RETAINED_INVOICE_BUCKET)
    .list(directory, { limit: 10, search: fileName });

  return !error && (data ?? []).some((entry) => entry.name === fileName);
}

/**
 * Promote a referenced OCR draft to its immutable fiscal-document location.
 * Copy -> row update -> draft removal keeps at least one valid object through
 * every retryable failure and makes the operation idempotent.
 */
export async function PATCH(request: Request) {
  const rl = rateLimitSensitive(request);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const supabaseService = getServiceRoleClient();
  if (!supabaseService) {
    console.error("[invoices/ocr] falta SUPABASE_SERVICE_ROLE_KEY: ruta desactivada");
    return NextResponse.json(
      { error: "La conservación de documentos no está configurada." },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Muro de pago: la cuenta en solo lectura no crea ni modifica.
  const blocked = await requireWriteAccess(user.id);
  if (blocked) return blocked;

  let body: { draft_url?: unknown; invoice_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const draftUrl = typeof body.draft_url === "string" ? body.draft_url : "";
  const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
  const draft = parseOwnedOcrDraftUrl(draftUrl, user.id);
  const confirmed = draft
    ? buildConfirmedInvoiceDocument(user.id, invoiceId, draft.fileName)
    : null;
  if (!draft || !confirmed) {
    return NextResponse.json({ error: "Borrador OCR inválido" }, { status: 400 });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("received_invoices")
    .select("id, document_url")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (invoiceError) {
    return NextResponse.json(
      { error: "No se pudo validar la factura" },
      { status: 500 }
    );
  }
  if (!invoice) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  let promoteLeaseId: string;
  try {
    promoteLeaseId = await beginAccountWriteLease(supabaseService, user.id, 180);
  } catch (lockErr) {
    return NextResponse.json(
      {
        error:
          lockErr instanceof Error
            ? lockErr.message
            : "No se pudo iniciar la conservación del documento.",
      },
      { status: 409 }
    );
  }

  try {
    if (invoice.document_url === confirmed.storageUrl) {
      await supabaseService.storage
        .from(RETAINED_INVOICE_BUCKET)
        .remove([draft.objectPath]);
      return NextResponse.json({ success: true, document_url: invoice.document_url });
    }
    if (invoice.document_url !== draftUrl) {
      return NextResponse.json(
        { error: "El borrador no pertenece a esta factura" },
        { status: 409 }
      );
    }

    let copiedByThisRequest = false;
    const { error: copyError } = await supabaseService.storage
      .from(RETAINED_INVOICE_BUCKET)
      .copy(draft.objectPath, confirmed.objectPath);
    if (copyError) {
      // A retry may find the destination created by a previous request that
      // failed after copying. Only continue after verifying that exact object.
      if (!(await retainedObjectExists(supabaseService, confirmed.objectPath))) {
        console.error("OCR draft copy error:", copyError);
        return NextResponse.json(
          { error: "No se pudo conservar el documento de la factura" },
          { status: 500 }
        );
      }
    } else {
      copiedByThisRequest = true;
    }

    const { data: updatedInvoice, error: updateError } = await supabase
      .from("received_invoices")
      .update({ document_url: confirmed.storageUrl })
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .eq("document_url", draftUrl)
      .select("id, document_url")
      .maybeSingle();

    if (updateError || !updatedInvoice) {
      const { data: currentInvoice } = await supabase
        .from("received_invoices")
        .select("document_url")
        .eq("id", invoiceId)
        .eq("user_id", user.id)
        .maybeSingle();
      const alreadyPromoted =
        currentInvoice?.document_url === confirmed.storageUrl;

      if (!alreadyPromoted) {
        if (copiedByThisRequest) {
          await supabaseService.storage
            .from(RETAINED_INVOICE_BUCKET)
            .remove([confirmed.objectPath]);
        }
        return NextResponse.json(
          { error: "No se pudo asociar el documento conservado a la factura" },
          { status: 500 }
        );
      }
    }

    const { error: removeError } = await supabaseService.storage
      .from(RETAINED_INVOICE_BUCKET)
      .remove([draft.objectPath]);
    if (removeError) {
      // The confirmed copy is already attached. Leaving an unreferenced draft is
      // safer than rolling back the fiscal document and can be cleaned later.
      console.warn("OCR draft cleanup error:", removeError.message);
    }

    return NextResponse.json({
      success: true,
      document_url: confirmed.storageUrl,
      draft_cleanup_pending: Boolean(removeError),
    });
  } finally {
    await endAccountWriteLease(supabaseService, promoteLeaseId);
  }
}

/** Delete an owned OCR draft only while no received invoice references it. */
export async function DELETE(request: Request) {
  const rl = rateLimitSensitive(request);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const supabaseService = getServiceRoleClient();
  if (!supabaseService) {
    console.error("[invoices/ocr] falta SUPABASE_SERVICE_ROLE_KEY: ruta desactivada");
    return NextResponse.json(
      { error: "La gestión de borradores no está configurada." },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let rawDraftUrl: unknown;
  try {
    rawDraftUrl = (await request.json() as { draft_url?: unknown }).draft_url;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const draft = parseOwnedOcrDraftUrl(rawDraftUrl, user.id);
  if (!draft) {
    return NextResponse.json({ error: "Borrador OCR inválido" }, { status: 400 });
  }

  // Use service role for the reference check so detached fiscal rows (marked
  // during a retryable account deletion) cannot become invisible and lose
  // their retained source document.
  const { count, error: referenceError } = await supabaseService
    .from("received_invoices")
    .select("id", { count: "exact", head: true })
    .eq("document_url", rawDraftUrl as string);
  if (referenceError) {
    return NextResponse.json(
      { error: "No se pudo comprobar el uso del borrador" },
      { status: 500 }
    );
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "El documento ya está asociado a una factura" },
      { status: 409 }
    );
  }

  let deleteLeaseId: string;
  try {
    deleteLeaseId = await beginAccountWriteLease(supabaseService, user.id, 180);
  } catch (lockErr) {
    return NextResponse.json(
      {
        error:
          lockErr instanceof Error
            ? lockErr.message
            : "No se pudo eliminar el borrador OCR.",
      },
      { status: 409 }
    );
  }
  let removeError: { message: string } | null = null;
  try {
    const result = await supabaseService.storage
      .from(RETAINED_INVOICE_BUCKET)
      .remove([draft.objectPath]);
    removeError = result.error;
  } finally {
    await endAccountWriteLease(supabaseService, deleteLeaseId);
  }
  if (removeError) {
    return NextResponse.json(
      { error: "No se pudo eliminar el borrador OCR" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
