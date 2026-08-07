import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase-server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rateLimitSensitive } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/account/delete — Borrado de cuenta (RGPD, art. 17 "derecho al
// olvido"). Acción irreversible.
//
// Seguridad:
//   · La identidad SIEMPRE sale de la sesión (cookies), nunca del body: un
//     usuario solo puede borrarse a sí mismo.
//   · Requiere confirmación explícita ("ELIMINAR") también en servidor.
//   · La SERVICE ROLE key solo vive aquí (servidor). Nunca en el navegador.
//
// Estrategia de borrado: se borran las filas del usuario EXPLÍCITAMENTE, en
// orden hijas → padres, en lugar de confiar en ON DELETE CASCADE. Solo
// agent_connections declara FK a profiles(id); el resto de tablas usan una
// columna user_id/company_id suelta o cuelgan de auth.users, así que el
// cascade no está garantizado. Borrar explícitamente es correcto en ambos
// casos (si hay cascade, las filas ya no estarán y el DELETE es un no-op).
//
// EXCEPCIÓN — cuatro tablas se ANONIMIZAN en lugar de borrarse (ver
// anonymizeRetainedRows). El derecho de supresión del RGPD (art. 17) no es
// absoluto: decae cuando el tratamiento es necesario para cumplir una
// obligación legal (art. 17.3.b) o para formular o defender reclamaciones
// (art. 17.3.e). En esos casos la vía correcta no es conservar el dato tal
// cual, sino romper el vínculo con la persona y quedarse solo con lo que la
// ley exige.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRMATION_TOKEN = "ELIMINAR";

/**
 * Migración que deja user_id nullable y la FK a auth.users en ON DELETE SET
 * NULL en las tablas de conservación obligatoria. Sin ella, desvincular la
 * fila es imposible y este endpoint aborta (ver anonymizeRetainedRows).
 */
const RETENTION_MIGRATION = "supabase/migrations/20260728_account_deletion_retention.sql";

/** Buckets de Storage donde se suben ficheros bajo el prefijo `${userId}/`. */
const STORAGE_BUCKETS = ["invoices", "company-branding"];

/**
 * Tablas hijas sin columna de usuario: se borran a partir de los ids del padre.
 * Se ejecuta ANTES que OWNED_TABLES para no dejar FKs colgando.
 *
 * issued_invoice_lines y fiscal_events NO aparecen aquí a propósito: cuelgan de
 * issued_invoices, que se conserva. Las líneas son contenido obligatorio de la
 * factura (una factura sin líneas no es una factura válida) y fiscal_events es
 * su traza de auditoría Verifactu.
 */
const CHILD_TABLES: { table: string; column: string; parent: ParentKey }[] = [
  { table: "delivery_note_lines", column: "delivery_note_id", parent: "delivery_notes" },
  { table: "order_lines", column: "order_id", parent: "orders" },
  { table: "budget_items", column: "budget_id", parent: "budgets" },
  { table: "budget_snapshots", column: "budget_id", parent: "budgets" },
  { table: "invoice_items", column: "invoice_id", parent: "invoices" },
  { table: "project_certification_lines", column: "certification_id", parent: "project_certifications" },
  { table: "project_milestones", column: "project_id", parent: "projects" },
  { table: "portal_tokens", column: "project_id", parent: "projects" },
  { table: "signature_otps", column: "signature_id", parent: "digital_signatures" },
];

type ParentKey =
  | "budgets"
  | "invoices"
  | "orders"
  | "delivery_notes"
  | "projects"
  | "project_certifications"
  | "digital_signatures";

/** Padres cuyos ids hay que recolectar para poder borrar las tablas hijas. */
const PARENT_TABLES: ParentKey[] = [
  "budgets",
  "invoices",
  "orders",
  "delivery_notes",
  "projects",
  "project_certifications",
  "digital_signatures",
];

/**
 * Tablas con columna de usuario. Orden significativo: hijas antes que padres
 * (p. ej. payments → invoices → clients).
 *
 * NO incluye issued_invoices, received_invoices, legal_acceptances ni
 * marketing_consents: esas cuatro se anonimizan (ver anonymizeRetainedRows).
 */
const OWNED_TABLES: { table: string; column: string }[] = [
  // Banco de precios propio del usuario
  { table: "price_alert_notifications", column: "user_id" },
  { table: "price_alerts", column: "user_id" },
  { table: "price_history", column: "user_id" },
  { table: "price_sync_logs", column: "user_id" },
  { table: "price_weekly_reports", column: "user_id" },
  { table: "resolved_prices", column: "user_id" },
  // Proveedores
  { table: "supplier_catalogs", column: "user_id" },
  { table: "supplier_payments", column: "user_id" },
  // Obra / proyectos
  { table: "project_documents", column: "user_id" },
  { table: "project_certifications", column: "user_id" },
  { table: "project_items", column: "user_id" },
  { table: "project_chapters", column: "user_id" },
  { table: "project_acts", column: "user_id" },
  { table: "project_changes", column: "user_id" },
  { table: "project_suppliers", column: "user_id" },
  // Facturación y cobros
  { table: "payment_reminders", column: "user_id" },
  { table: "payments", column: "user_id" },
  { table: "delivery_notes", column: "user_id" },
  { table: "orders", column: "user_id" },
  { table: "invoices", column: "user_id" },
  { table: "budgets", column: "user_id" },
  { table: "budget_analysis_cache", column: "user_id" },
  { table: "price_items", column: "user_id" },
  // CRM
  { table: "messages", column: "user_id" },
  { table: "events", column: "user_id" },
  { table: "digital_signatures", column: "user_id" },
  { table: "projects", column: "user_id" },
  { table: "clients", column: "user_id" },
  { table: "suppliers", column: "user_id" },
  { table: "expense_categories", column: "user_id" },
  // Agente
  { table: "agent_campaigns", column: "user_id" },
  { table: "agent_daily_summary", column: "user_id" },
  { table: "agent_leads", column: "user_id" },
  { table: "agent_news", column: "user_id" },
  { table: "agent_reviews", column: "user_id" },
  { table: "agent_signals", column: "user_id" },
  { table: "agent_tasks", column: "user_id" },
  { table: "agent_connections", column: "user_id" },
  // Configuración, avisos y trazas
  { table: "ai_runs", column: "user_id" },
  { table: "notifications", column: "user_id" },
  { table: "notification_preferences", column: "user_id" },
  { table: "margin_config", column: "user_id" },
  { table: "fiscal_settings", column: "user_id" },
  { table: "activity_log", column: "user_id" },
  // Historial de versiones: no tiene user_id, cuelga de changed_by. Guarda
  // snapshots completos de presupuestos y facturas, así que conservarlo
  // desharía por la puerta de atrás la anonimización de issued_invoices.
  { table: "document_versions", column: "changed_by" },
];

/**
 * Columnas sueltas que guardan el uuid del usuario en tablas que NO son suyas
 * (registros globales o de otros usuarios). No se borra la fila: solo se
 * rompe el vínculo con la persona poniendo la referencia a null.
 */
const AUTHOR_REFERENCES: { table: string; column: string }[] = [
  { table: "technical_import_logs", column: "imported_by" },
  { table: "ai_runs", column: "reviewed_by" },
  { table: "data_subject_requests", column: "handled_by" },
  { table: "security_incidents", column: "reported_by" },
];

/**
 * Códigos que significan "esa tabla/columna no existe en este proyecto":
 * el esquema varía entre entornos, así que se ignoran en vez de abortar.
 * Cualquier otro error sí aborta (mejor dejar la cuenta viva que huérfana).
 */
const IGNORABLE_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "PGRST106", // schema no expuesto
  "PGRST202", // función no encontrada
  "PGRST204", // columna no encontrada en el schema cache
  "PGRST205", // tabla no encontrada en el schema cache
]);

interface DeletionError {
  table: string;
  message: string;
}

function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** DELETE ... WHERE column = value. Tolera tablas/columnas inexistentes. */
async function deleteBy(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string,
  errors: DeletionError[]
) {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error && !IGNORABLE_CODES.has(error.code ?? "")) {
    errors.push({ table, message: error.message });
  }
}

/** DELETE ... WHERE column IN (...). Trocea la lista para no pasarse de URL. */
async function deleteByIn(
  admin: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  errors: DeletionError[]
) {
  if (values.length === 0) return;
  for (const part of chunk(values)) {
    const { error } = await admin.from(table).delete().in(column, part);
    if (error && !IGNORABLE_CODES.has(error.code ?? "")) {
      errors.push({ table, message: error.message });
      return;
    }
  }
}

/** Recolecta ids de una tabla filtrando por una columna. */
async function collectIds(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string
): Promise<string[]> {
  const { data, error } = await admin.from(table).select("id").eq(column, value);
  if (error) return [];
  return (data ?? []).map((row) => String((row as { id: unknown }).id));
}

/** Cuenta cuántos de esos ids siguen existiendo en la tabla. */
async function countRows(
  admin: SupabaseClient,
  table: string,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const part of chunk(ids)) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", part);
    if (error) return total;
    total += count ?? 0;
  }
  return total;
}

/**
 * Anonimiza las filas que NO se pueden borrar, rompiendo su vínculo con la
 * persona y quitando los datos personales que la ley no obliga a conservar.
 *
 * Se ejecuta ANTES de cualquier DELETE por dos motivos:
 *   a) estas filas apuntan por FK a clients / projects / budgets / suppliers /
 *      expense_categories; hay que poner esas referencias a null antes de
 *      borrar esas tablas o el DELETE fallaría.
 *   b) si la anonimización falla, se aborta sin haber borrado nada.
 *
 * ── issued_invoices y received_invoices ────────────────────────────────────
 * NO se borran: el art. 30 del Código de Comercio y la LGT obligan a conservar
 * las facturas —emitidas Y recibidas— (~4 años, 6 los libros mercantiles). Es
 * una obligación legal del art. 17.3.b RGPD, que prevalece sobre el derecho de
 * supresión. Lo que se hace es desvincular la factura de la cuenta:
 *   · user_id → null. Requiere la migración RETENTION_MIGRATION: de fábrica
 *     estas tablas tienen user_id NOT NULL con FK a auth.users sin ON DELETE,
 *     lo que hace imposible desvincular la fila e impide incluso borrar el
 *     usuario. Con user_id a null la fila deja además de ser visible por RLS
 *     (las políticas comparan auth.uid() = user_id), así que el registro
 *     conservado queda fuera de la aplicación.
 *   · client_id / project_id / budget_id (emitidas) y supplier_id /
 *     category_id / project_id (recibidas) → null: esos registros sí se borran.
 *   · client_email y notes → null: NO son contenido obligatorio de factura
 *     (RD 1619/2012 art. 6), así que son datos personales prescindibles.
 * Se conservan intactos importes, impuestos, fechas, numeración, los campos
 * verifactu_* y los datos fiscales de las partes (issuer_nif, client_nif,
 * supplier_nif, direcciones…): son contenido OBLIGATORIO de la factura y
 * alterarlos la invalidaría ante Hacienda y rompería la cadena de hash
 * Verifactu. Anonimizarlos vaciaría de sentido la propia conservación.
 * En recibidas se mantiene también document_url: apunta al documento del
 * proveedor, que es justo lo que hay que conservar (y no vive en el bucket
 * que se vacía, que es el de la tabla invoices).
 *
 * ── legal_acceptances y marketing_consents ─────────────────────────────────
 * NO se borran: son la PRUEBA de que se aceptaron los términos y de que se
 * dio (o se revocó) el consentimiento. El art. 7.1 RGPD exige poder
 * demostrarlo, y el art. 17.3.e ampara conservarlo para defenderse frente a
 * reclamaciones. Se conserva qué se aceptó y cuándo (document_type,
 * document_version, accepted_at, consent_type, status, granted_at,
 * revoked_at) y se elimina todo lo que identifica a la persona: el vínculo al
 * usuario y las huellas técnicas (ip_address, user_agent).
 */
async function anonymizeRetainedRows(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[]
): Promise<{ issuedIds: string[]; receivedIds: string[] }> {
  const issuedIds = await collectIds(admin, "issued_invoices", "user_id", userId);
  const receivedIds = await collectIds(admin, "received_invoices", "user_id", userId);

  const updates: { table: string; values: Record<string, unknown> }[] = [
    {
      table: "issued_invoices",
      values: {
        user_id: null,
        client_id: null,
        project_id: null,
        budget_id: null,
        client_email: null,
        notes: null,
      },
    },
    {
      table: "received_invoices",
      values: {
        user_id: null,
        supplier_id: null,
        category_id: null,
        project_id: null,
        notes: null,
      },
    },
    {
      table: "legal_acceptances",
      values: { user_id: null, ip_address: null, user_agent: null },
    },
    {
      table: "marketing_consents",
      values: { user_id: null, client_id: null, ip_address: null, user_agent: null },
    },
  ];

  for (const { table, values } of updates) {
    const { error } = await admin.from(table).update(values).eq("user_id", userId);
    if (!error || IGNORABLE_CODES.has(error.code ?? "")) continue;

    // 23502 (not null) y 23503 (FK) significan lo mismo aquí: el esquema no
    // permite desvincular la fila de su titular. Se aborta en vez de borrar
    // datos que la ley obliga a conservar.
    const needsMigration = error.code === "23502" || error.code === "23503";
    const message = needsMigration
      ? `${error.message} — ${table}.user_id no admite quedarse sin titular. ` +
        `Aplica la migración ${RETENTION_MIGRATION} (user_id nullable + FK ON DELETE SET NULL).`
      : error.message;
    errors.push({ table, message });
  }

  return { issuedIds, receivedIds };
}

/** Pone a null las referencias de autoría en tablas que no son del usuario. */
async function clearAuthorReferences(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[]
) {
  for (const { table, column } of AUTHOR_REFERENCES) {
    const { error } = await admin
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);
    if (error && !IGNORABLE_CODES.has(error.code ?? "")) {
      errors.push({ table, message: error.message });
    }
  }
}

/** Borra el banco de precios privado del usuario (pb_*, ligado por company_id). */
async function deletePrivatePriceBank(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[]
) {
  const providerIds = await collectIds(admin, "pb_providers", "company_id", userId);
  const sourceIds = await collectIds(admin, "pb_price_sources", "company_id", userId);

  let productIds: string[] = [];
  if (providerIds.length > 0) {
    const { data } = await admin.from("pb_products").select("id").in("provider_id", providerIds);
    productIds = (data ?? []).map((row) => String((row as { id: unknown }).id));
  }

  await deleteByIn(admin, "pb_price_observations", "product_id", productIds, errors);
  await deleteByIn(admin, "pb_price_observations", "provider_id", providerIds, errors);
  await deleteByIn(admin, "pb_price_current", "product_id", productIds, errors);
  await deleteByIn(admin, "pb_price_current", "provider_id", providerIds, errors);
  await deleteByIn(admin, "pb_sync_runs", "source_id", sourceIds, errors);
  await deleteByIn(admin, "pb_sync_runs", "provider_id", providerIds, errors);
  await deleteByIn(admin, "pb_products", "id", productIds, errors);
  await deleteBy(admin, "pb_price_sources", "company_id", userId, errors);
  await deleteBy(admin, "pb_providers", "company_id", userId, errors);
}

/** Borra los ficheros del usuario en Storage (prefijo `${userId}/`). */
async function deleteStorageFiles(admin: SupabaseClient, userId: string) {
  const PAGE = 100;
  for (const bucket of STORAGE_BUCKETS) {
    // list() pagina: hay que vaciar en bucle o se quedarían ficheros atrás.
    // Se borra siempre la primera página porque al eliminarla el resto sube.
    for (;;) {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(userId, { limit: PAGE, offset: 0 });
      if (error) {
        console.error(`[account/delete] storage list ${bucket}:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;

      const paths = data.map((file) => `${userId}/${file.name}`);
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) {
        // No bloquea el borrado de la cuenta: se registra para poder limpiarlo.
        console.error(`[account/delete] storage ${bucket}:`, removeError.message);
        break;
      }
      if (data.length < PAGE) break;
    }
  }
}

export async function POST(request: Request) {
  const rl = rateLimitSensitive(request);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  // 1) Sesión: la identidad sale SIEMPRE de la cookie, nunca del body.
  const supabase = await createSessionClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return NextResponse.json({ error: "No hay sesión activa." }, { status: 401 });
  }

  // 2) Confirmación explícita, revalidada en servidor.
  let confirmation: unknown;
  try {
    const body = await request.json();
    confirmation = (body as { confirmation?: unknown })?.confirmation;
  } catch {
    confirmation = undefined;
  }
  if (confirmation !== CONFIRMATION_TOKEN) {
    return NextResponse.json(
      { error: `Confirmación inválida. Debes enviar "${CONFIRMATION_TOKEN}".` },
      { status: 400 }
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("[account/delete] falta SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "El borrado de cuentas no está configurado en este entorno." },
      { status: 500 }
    );
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userId = user.id;
  const errors: DeletionError[] = [];

  try {
    // 3) Ids de los padres, necesarios para borrar las tablas hijas.
    const parentIds = {} as Record<ParentKey, string[]>;
    for (const table of PARENT_TABLES) {
      parentIds[table] = await collectIds(admin, table, "user_id", userId);
    }

    // 4) Anonimizar lo que se conserva por obligación legal. Va primero: deja
    //    las FKs a clients/projects/budgets a null y, si falla, no se ha
    //    borrado nada todavía.
    const { issuedIds, receivedIds } = await anonymizeRetainedRows(admin, userId, errors);
    if (errors.length > 0) {
      console.error("[account/delete] errores anonimizando:", errors);
      return NextResponse.json(
        {
          error:
            "No se pudieron anonimizar los registros de conservación obligatoria. " +
            "No se ha eliminado nada.",
          details: errors,
        },
        { status: 500 }
      );
    }

    // 5) Hijas → padres.
    for (const { table, column, parent } of CHILD_TABLES) {
      await deleteByIn(admin, table, column, parentIds[parent], errors);
    }
    for (const { table, column } of OWNED_TABLES) {
      await deleteBy(admin, table, column, userId, errors);
    }
    await deletePrivatePriceBank(admin, userId, errors);
    await clearAuthorReferences(admin, userId, errors);

    // 6) Si algo falló, se aborta ANTES de tocar auth: es preferible una
    //    cuenta viva con datos a medio borrar (reintentable) que un usuario
    //    de auth borrado dejando datos personales huérfanos.
    if (errors.length > 0) {
      console.error("[account/delete] errores borrando datos:", errors);
      return NextResponse.json(
        {
          error: "No se pudieron borrar todos tus datos. No se ha eliminado la cuenta.",
          details: errors,
        },
        { status: 500 }
      );
    }

    await deleteStorageFiles(admin, userId);

    // 7) Perfil y usuario de auth (requiere service role).
    const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileError && !IGNORABLE_CODES.has(profileError.code ?? "")) {
      console.error("[account/delete] profiles:", profileError);
      return NextResponse.json(
        { error: "No se pudo eliminar el perfil. No se ha eliminado la cuenta." },
        { status: 500 }
      );
    }

    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[account/delete] auth.admin.deleteUser:", authError);
      return NextResponse.json(
        { error: "Tus datos se han borrado, pero no se pudo eliminar la cuenta de acceso." },
        { status: 500 }
      );
    }

    // 8) Comprobación posterior: si estas tablas tuvieran un ON DELETE CASCADE
    //    hacia auth.users, borrar el usuario se habría llevado por delante las
    //    facturas que la ley obliga a conservar. No es reversible, pero debe
    //    quedar registrado en vez de pasar en silencio.
    const retainedIssued = await countRows(admin, "issued_invoices", issuedIds);
    const retainedReceived = await countRows(admin, "received_invoices", receivedIds);

    for (const [table, expected, actual] of [
      ["issued_invoices", issuedIds.length, retainedIssued],
      ["received_invoices", receivedIds.length, retainedReceived],
    ] as const) {
      if (expected > 0 && actual < expected) {
        console.error(
          `[account/delete] ATENCIÓN: se esperaban ${expected} filas conservadas en ${table} y ` +
            `quedan ${actual}. Revisa si ${table}.user_id tiene ON DELETE CASCADE hacia auth.users.`
        );
      }
    }

    console.warn(
      `[account/delete] cuenta eliminada: ${userId} ` +
        `(facturas conservadas — emitidas: ${retainedIssued}, recibidas: ${retainedReceived})`
    );
    return NextResponse.json({
      ok: true,
      retainedInvoices: { issued: retainedIssued, received: retainedReceived },
    });
  } catch (err) {
    console.error("[account/delete] error inesperado:", err);
    return NextResponse.json(
      { error: "Error inesperado al eliminar la cuenta. No se ha completado el borrado." },
      { status: 500 }
    );
  }
}
