import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      user_id,
      entity_type,
      entity_id,
      signer_name,
      signer_email,
      signer_phone,
      signer_nif,
      signer_role,
      signature_image,
      ip_address,
      user_agent,
    } = body;

    if (!user_id || !entity_type || !entity_id || !signer_name) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("digital_signatures")
      .insert({
        user_id,
        entity_type,
        entity_id,
        signer_name,
        signer_email: signer_email || "",
        signer_phone: signer_phone || "",
        signer_nif: signer_nif || "",
        signer_role: signer_role || "cliente",
        signature_image: signature_image || "",
        ip_address: ip_address || "",
        user_agent: user_agent || "",
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
