import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { hashSignatureToken } from "@/lib/signature-token";

// GET: Fetch signature info for public signing page (no auth required —
// the random public_token, not the guessable signature UUID, is what
// authorizes this lookup).
export async function GET(request: Request) {
  try {
    const supabase = getServiceRoleClient();
    if (!supabase) {
      console.error("[signatures/public] falta configuración de service role");
      return NextResponse.json(
        { error: "El servicio de firma no está disponible en este momento." },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Falta token" }, { status: 400 });
    }

    const { data: sig, error } = await supabase
      .from("digital_signatures")
      .select("id, entity_type, entity_id, signer_name, signer_email, signer_role, status, signed_at, signature_image")
      .eq("public_token_hash", hashSignatureToken(token))
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

// POST: Save signature image from public page (no auth required — gated
// by the same random token).
export async function POST(request: Request) {
  try {
    const supabase = getServiceRoleClient();
    if (!supabase) {
      console.error("[signatures/public] falta configuración de service role");
      return NextResponse.json(
        { error: "El servicio de firma no está disponible en este momento." },
        { status: 503 }
      );
    }

    const { token, signature_image, ip_address, user_agent } = await request.json();

    if (!token || !signature_image) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }

    const { data: sig } = await supabase
      .from("digital_signatures")
      .select("id, status")
      .eq("public_token_hash", hashSignatureToken(token))
      .maybeSingle();
    if (!sig) {
      return NextResponse.json({ error: "Firma no encontrada" }, { status: 404 });
    }
    if (sig.status !== "pending") {
      return NextResponse.json({ error: "Esta firma ya se ha completado" }, { status: 409 });
    }

    const { data, error } = await supabase.rpc("save_signature_image_locked", {
      p_signature_id: sig.id,
      p_signature_image: signature_image,
      p_ip_address: ip_address || "",
      p_user_agent: user_agent || "",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const result = data as { ok: boolean; reason?: string };
    if (!result.ok) {
      const status = result.reason === "account_locked" ? 409 : 404;
      return NextResponse.json({ error: result.reason || "No se pudo guardar la firma" }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
