import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient as createUserClient } from "@/lib/supabase-server";

const REQUEST_TYPE = "manual_price_sync";
const REQUEST_SECTOR = "construccion";
const MAX_REQUEST_AGE_MS = 90 * 60 * 1000;

type RequestPhase = "pending" | "running" | "completed" | "failed";

interface SyncRequestData {
  kind: typeof REQUEST_TYPE;
  requested_by: string;
  requested_at: string;
  phase: RequestPhase;
  started_at?: string;
  completed_at?: string;
  progress?: {
    completed?: number;
    total?: number;
    label?: string;
  };
  result?: Record<string, unknown>;
  error?: string;
}

interface SyncRequestRow {
  id: string;
  status: "processing" | "completed" | "failed";
  created_at: string;
  processed_at: string | null;
  data: SyncRequestData;
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function hasN8nAuthorization(request: Request) {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const validTokens = [
    process.env.AGENT_API_KEY,
    process.env.WEBHOOK_SECRET,
    process.env.SYNC_API_KEY,
  ].filter(Boolean);

  return Boolean(token && validTokens.includes(token));
}

function publicStatus(row: SyncRequestRow) {
  const phase =
    row.status === "completed" || row.status === "failed"
      ? row.status
      : row.data?.phase || "pending";

  return {
    id: row.id,
    status: phase,
    progress: row.data?.progress || null,
    result: row.data?.result || null,
    error: row.data?.error || null,
    requested_at: row.data?.requested_at || row.created_at,
    started_at: row.data?.started_at || null,
    completed_at: row.data?.completed_at || row.processed_at || null,
  };
}

function isStaleRequest(row: SyncRequestRow, now = Date.now()) {
  if (
    row.status !== "processing" ||
    (row.data?.phase !== "pending" && row.data?.phase !== "running")
  ) {
    return false;
  }

  const referenceDate =
    row.data?.started_at ||
    row.data?.requested_at ||
    row.created_at;
  const referenceTime = new Date(referenceDate).getTime();
  return (
    Number.isFinite(referenceTime) &&
    now - referenceTime > MAX_REQUEST_AGE_MS
  );
}

async function getAuthenticatedUser() {
  const supabase = await createUserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return error ? null : user;
}

async function handleUserRequest(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "La conexión segura con Supabase no está configurada" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const sector = body?.sector || REQUEST_SECTOR;
  if (sector !== REQUEST_SECTOR) {
    return NextResponse.json(
      { error: "Este rastreador solo admite el sector construcción" },
      { status: 400 }
    );
  }

  const { data: openRows, error: openError } = await admin
    .from("n8n_updates")
    .select("id,status,created_at,processed_at,data")
    .eq("sector", REQUEST_SECTOR)
    .eq("update_type", REQUEST_TYPE)
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(50);

  if (openError) {
    return NextResponse.json(
      { error: `No se pudo consultar la cola de n8n: ${openError.message}` },
      { status: 500 }
    );
  }

  const existing = (openRows as SyncRequestRow[] | null)?.find(
    (row) => row.data?.requested_by === user.id
  );
  if (existing) {
    return NextResponse.json(
      { ok: true, reused: true, request: publicStatus(existing) },
      { status: 200 }
    );
  }

  const now = new Date().toISOString();
  const requestData: SyncRequestData = {
    kind: REQUEST_TYPE,
    requested_by: user.id,
    requested_at: now,
    phase: "pending",
    progress: {
      completed: 0,
      total: 5,
      label: "Esperando a n8n",
    },
  };

  const { data: created, error: createError } = await admin
    .from("n8n_updates")
    .insert({
      sector: REQUEST_SECTOR,
      update_type: REQUEST_TYPE,
      data: requestData,
      status: "processing",
    })
    .select("id,status,created_at,processed_at,data")
    .single();

  if (createError || !created) {
    return NextResponse.json(
      {
        error: `No se pudo crear la solicitud de n8n: ${
          createError?.message || "sin respuesta"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, reused: false, request: publicStatus(created as SyncRequestRow) },
    { status: 202 }
  );
}

async function claimNextRequest() {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no está configurada" },
      { status: 503 }
    );
  }

  const { data: rows, error } = await admin
    .from("n8n_updates")
    .select("id,status,created_at,processed_at,data")
    .eq("sector", REQUEST_SECTOR)
    .eq("update_type", REQUEST_TYPE)
    .eq("status", "processing")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: `No se pudo consultar la cola: ${error.message}` },
      { status: 500 }
    );
  }

  const now = Date.now();
  const candidates = (rows as SyncRequestRow[] | null) || [];

  for (const stale of candidates.filter((row) => isStaleRequest(row, now))) {
    const completedAt = new Date().toISOString();
    await admin
      .from("n8n_updates")
      .update({
        status: "failed",
        processed_at: completedAt,
        data: {
          ...stale.data,
          phase: "failed",
          completed_at: completedAt,
          error: "La ejecución de n8n superó el tiempo máximo permitido",
        },
      })
      .eq("id", stale.id)
      .eq("status", "processing");
  }

  const pending = candidates.find((row) => row.data?.phase === "pending");
  if (!pending) {
    return NextResponse.json({
      ok: true,
      request_id: null,
      message: "No hay solicitudes pendientes",
    });
  }

  const startedAt = new Date().toISOString();
  const updatedData: SyncRequestData = {
    ...pending.data,
    phase: "running",
    started_at: startedAt,
    progress: {
      completed: 0,
      total: 5,
      label: "n8n ha iniciado el rastreo",
    },
  };

  const { data: claimed, error: claimError } = await admin
    .from("n8n_updates")
    .update({ data: updatedData })
    .eq("id", pending.id)
    .eq("status", "processing")
    .select("id,status,created_at,processed_at,data")
    .single();

  if (claimError || !claimed) {
    return NextResponse.json(
      { error: `No se pudo reservar la solicitud: ${claimError?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    request_id: claimed.id,
    requested_by: updatedData.requested_by,
    status: "running",
  });
}

async function updateRequestFromN8n(
  action: "progress" | "complete" | "fail",
  body: Record<string, unknown>
) {
  const requestId =
    typeof body.request_id === "string" ? body.request_id.trim() : "";
  if (!requestId) {
    return NextResponse.json(
      { error: "request_id es obligatorio" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no está configurada" },
      { status: 503 }
    );
  }

  const { data: current, error: readError } = await admin
    .from("n8n_updates")
    .select("id,status,created_at,processed_at,data")
    .eq("id", requestId)
    .eq("sector", REQUEST_SECTOR)
    .eq("update_type", REQUEST_TYPE)
    .single();

  if (readError || !current) {
    return NextResponse.json(
      { error: "Solicitud no encontrada" },
      { status: 404 }
    );
  }

  const currentRow = current as SyncRequestRow;
  const completedAt = new Date().toISOString();
  const nextStatus =
    action === "complete"
      ? "completed"
      : action === "fail"
        ? "failed"
        : "processing";
  const nextPhase: RequestPhase =
    action === "complete"
      ? "completed"
      : action === "fail"
        ? "failed"
        : "running";

  const nextData: SyncRequestData = {
    ...currentRow.data,
    phase: nextPhase,
    ...(body.progress && typeof body.progress === "object"
      ? { progress: body.progress as SyncRequestData["progress"] }
      : {}),
    ...(body.result && typeof body.result === "object"
      ? { result: body.result as Record<string, unknown> }
      : {}),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
    ...(action === "complete" || action === "fail"
      ? { completed_at: completedAt }
      : {}),
  };

  const { data: updated, error: updateError } = await admin
    .from("n8n_updates")
    .update({
      status: nextStatus,
      data: nextData,
      ...(action === "complete" || action === "fail"
        ? { processed_at: completedAt }
        : {}),
    })
    .eq("id", requestId)
    .select("id,status,created_at,processed_at,data")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: `No se pudo actualizar la solicitud: ${updateError?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    request: publicStatus(updated as SyncRequestRow),
  });
}

async function handleN8nRequest(request: Request) {
  if (!hasN8nAuthorization(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const action = body.action;

  if (action === "claim") return claimNextRequest();
  if (action === "progress" || action === "complete" || action === "fail") {
    return updateRequestFromN8n(action, body);
  }

  return NextResponse.json(
    { error: "Acción de n8n no reconocida" },
    { status: 400 }
  );
}

export async function POST(request: Request) {
  return hasN8nAuthorization(request)
    ? handleN8nRequest(request)
    : handleUserRequest(request);
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "La conexión segura con Supabase no está configurada" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const requestId = url.searchParams.get("id");
  const activeOnly = url.searchParams.get("active") === "1";
  let query = admin
    .from("n8n_updates")
    .select("id,status,created_at,processed_at,data")
    .eq("sector", REQUEST_SECTOR)
    .eq("update_type", REQUEST_TYPE)
    .order("created_at", { ascending: false })
    .limit(requestId ? 1 : 50);

  if (requestId) query = query.eq("id", requestId);
  else if (activeOnly) query = query.eq("status", "processing");

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: `No se pudo consultar la solicitud: ${error.message}` },
      { status: 500 }
    );
  }

  let ownRequest = ((rows as SyncRequestRow[] | null) || []).find(
    (row) => row.data?.requested_by === user.id
  );

  if (!ownRequest) {
    return NextResponse.json(
      { error: "Solicitud no encontrada" },
      { status: 404 }
    );
  }

  if (isStaleRequest(ownRequest)) {
    const completedAt = new Date().toISOString();
    const { data: failedRequest } = await admin
      .from("n8n_updates")
      .update({
        status: "failed",
        processed_at: completedAt,
        data: {
          ...ownRequest.data,
          phase: "failed",
          completed_at: completedAt,
          error:
            "La ejecución de n8n superó los 90 minutos y se detuvo para proteger la sincronización",
        },
      })
      .eq("id", ownRequest.id)
      .eq("status", "processing")
      .select("id,status,created_at,processed_at,data")
      .single();

    if (failedRequest) ownRequest = failedRequest as SyncRequestRow;
  }

  return NextResponse.json({ ok: true, request: publicStatus(ownRequest) });
}
