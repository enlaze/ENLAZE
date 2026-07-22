import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: Fetch signature info for public signing page (no auth required)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const signatureId = url.searchParams.get("id");

    if (!signatureId) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const { data: sig, error } = await supabase
      .from("digital_signatures")
      .select("id, entity_type, entity_id, signer_name, signer_email, signer_role, status, signed_at, signature_image")
      .eq("id", signatureId)
      .single();

    if (error || !sig) {
      return NextResponse.json({ error: "Firma no encontrada" }, { status: 404 });
    }

    // Get document info based on entity_type
    let documentInfo: { title: string; detail: string } = { title: "", detail: "" };

    if (sig.entity_type === "budget") {
      const { data: b } = await supabase
        .from("budgets")
        .select("title, budget_number, total")
        .eq("id", sig.entity_id)
        .single();
      if (b) {
        documentInfo = {
          title: `Presupuesto ${b.budget_number}`,
          detail: b.title || "",
        };
      }
    } else if (sig.entity_type === "certification") {
      const { data: c } = await supabase
        .from("project_certifications")
        .select("cert_number, period")
        .eq("id", sig.entity_id)
        .single();
      if (c) {
        documentInfo = {
          title: `Certificación #${c.cert_number}`,
          detail: c.period || "",
        };
      }
    } else if (sig.entity_type === "work_report") {
      const { data: w } = await supabase
        .from("work_reports")
        .select("report_date")
        .eq("id", sig.entity_id)
        .single();
      if (w) {
        documentInfo = {
          title: "Parte de trabajo",
          detail: new Date(w.report_date).toLocaleDateString("es-ES"),
        };
      }
    } else if (sig.entity_type === "project_act") {
      const { data: a } = await supabase
        .from("project_acts")
        .select("title, act_type, act_date")
        .eq("id", sig.entity_id)
        .single();
      if (a) {
        const typeLabels: Record<string, string> = {
          inicio: "Acta de inicio",
          replanteo: "Acta de replanteo",
          recepcion: "Acta de recepción",
          fin: "Acta de fin de obra",
          incidencia: "Acta de incidencia",
        };
        documentInfo = {
          title: typeLabels[a.act_type] || "Acta",
          detail: a.title || "",
        };
      }
    }

    return NextResponse.json({
      ...sig,
      document: documentInfo,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}

// POST: Save signature image from public page (no auth required)
export async function POST(request: Request) {
  try {
    const { signature_id, signature_image, ip_address, user_agent } = await request.json();

    if (!signature_id || !signature_image) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }

    // Update signature with the drawn image
    const { error } = await supabase
      .from("digital_signatures")
      .update({
        signature_image,
        ip_address: ip_address || "",
        user_agent: user_agent || "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", signature_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
