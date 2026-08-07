import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase-server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rateLimitSensitive } from "@/lib/rate-limit";
import {
  RETAINED_INVOICE_BUCKET,
  buildLegacyReceivedInvoiceDocument,
  parseRetainedReceivedInvoiceDocumentUrl,
} from "@/lib/invoice-ocr-drafts";
import { deleteStorageTree } from "@/lib/storage-cleanup";
import {
  FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES,
  isAccountDeletionCleanupComplete,
  isFiscallyDefinitiveIssuedInvoiceStatus,
  markAccountDeletionCleanupComplete,
} from "@/lib/account-deletion-retention";

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
// EXCEPCIÓN — cuatro tablas contienen filas que se ANONIMIZAN en lugar de
// borrarse (ver anonymizeRetainedRows; los issued_invoices en draft sí se
// eliminan). El derecho de supresión del RGPD (art. 17) no es
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

/**
 * Migración que crea account_deletion_locks, account_write_leases y el
 * trigger/policies que rechazan nuevas escrituras de un usuario mientras
 * existe su lock. Sin ella este endpoint no tiene forma de cerrar la
 * ventana de carrera entre el arranque del borrado y su finalización, así
 * que aborta en vez de proceder sin esa protección (ver lockAccountForDeletion).
 */
const WRITE_LOCK_MIGRATION = "supabase/migrations/20260806_03_account_deletion_write_lock.sql";

/** Bucket de Storage donde se suben ficheros bajo el prefijo `${userId}/`. */
const STORAGE_BUCKETS = ["invoices", "company-branding", "project-docs"];

/**
 * Tablas hijas sin columna de usuario: se borran a partir de los ids del padre.
 * Se ejecuta ANTES que OWNED_TABLES para no dejar FKs colgando.
 *
 * issued_invoice_lines y fiscal_events se tratan aparte: se conservan con las
 * facturas fiscalmente definitivas, pero se borran junto a las que aún están en
 * estado draft.
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
 * marketing_consents: los borradores emitidos se eliminan y el resto de esas
 * filas se anonimiza (ver anonymizeRetainedRows).
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

// A deployment may genuinely omit an optional retention table, but an
// existing fiscal table without deleted_by cannot provide retry safety and
// must abort instead of being mistaken for an ignorable schema variation.
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST106", "PGRST205"]);

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

/** Tamaño de página al paginar SELECTs que pueden superar el límite de PostgREST. */
const SELECT_PAGE_SIZE = 1000;

/**
 * Repite un SELECT paginando con .range() hasta agotar los resultados. Sin
 * esto, una cuenta con más filas que el límite de respuesta de PostgREST
 * perdería en silencio las páginas siguientes — crítico en las lecturas que
 * alimentan la lista de documentos a conservar antes de borrar Storage.
 */
async function selectAllRows<T>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>
): Promise<{ data: T[]; error: { code?: string; message: string } | null }> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + SELECT_PAGE_SIZE - 1);
    if (error) {
      return { data: rows, error };
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SELECT_PAGE_SIZE) {
      break;
    }
    from += SELECT_PAGE_SIZE;
  }
  return { data: rows, error: null };
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
 *   b) si falla, se aborta antes del borrado general y de Auth; las operaciones
 *      que ya terminaron son idempotentes y se redescubren mediante deleted_by.
 *
 * ── issued_invoices y received_invoices ────────────────────────────────────
 * Las issued_invoices en draft aún son documentos editables, no facturas
 * fiscalmente definitivas: se borran junto a sus líneas y eventos. Las emitidas
 * que ya salieron de draft y todas las recibidas sí se conservan por el art. 30
 * del Código de Comercio y la LGT (~4 años, 6 los libros mercantiles). Es una
 * obligación legal del art. 17.3.b RGPD. Esas filas se desvinculan de la cuenta:
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
 * proveedor, que es justo lo que hay que conservar.
 *
 * La desvinculación (user_id -> null) actúa además como barrera estable frente
 * a la promoción OCR: PATCH solo puede cambiar una fila que aún tenga el
 * user_id autenticado. Las rutas de Storage se vuelven a leer DESPUÉS de esa
 * barrera. Así, o se observa la copia confirmada o se conserva el draft que
 * sigue referenciado, pero nunca una instantánea intermedia susceptible de
 * cambiar durante la limpieza.
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

/**
 * Copia un documento de factura recibida heredado del bucket público
 * "invoices" al bucket privado RETAINED_INVOICE_BUCKET y repunta la fila a
 * esa nueva ubicación. Reintentable en cada paso: el `upload` con
 * `upsert: false` hace que una copia ya hecha en un intento anterior sea un
 * no-op seguro, y el `document_url` original NUNCA se borra del bucket
 * público hasta que el UPDATE de la fila confirma que ya apunta al
 * documento privado. Un fallo en cualquier paso deja el objeto público
 * intacto (se sigue excluyendo de la limpieza) en vez de perder el único
 * documento fiscal disponible.
 */
async function migrateLegacyReceivedInvoiceDocument(
  admin: SupabaseClient,
  userId: string,
  invoiceId: string,
  legacyObjectPath: string,
  currentDocumentUrl: string
): Promise<{ migratedObjectPath: string } | null> {
  const fileName = legacyObjectPath.split("/").pop() || "";
  const target = buildLegacyReceivedInvoiceDocument(userId, invoiceId, fileName);
  if (!target) {
    console.warn(
      `[account/delete] no se pudo construir la ruta privada para ${legacyObjectPath}`
    );
    return null;
  }

  const legacyDir = `${userId}/legacy/${invoiceId}`;
  const { data: existingList } = await admin.storage
    .from(RETAINED_INVOICE_BUCKET)
    .list(legacyDir, { search: fileName });
  const alreadyCopied = (existingList ?? []).some((entry) => entry.name === fileName);

  if (!alreadyCopied) {
    const { data: downloaded, error: downloadError } = await admin.storage
      .from("invoices")
      .download(legacyObjectPath);
    if (downloadError || !downloaded) {
      console.warn(
        `[account/delete] no se pudo leer el documento heredado ${legacyObjectPath}:`,
        downloadError?.message
      );
      return null;
    }
    const { error: uploadError } = await admin.storage
      .from(RETAINED_INVOICE_BUCKET)
      .upload(target.objectPath, downloaded, { upsert: false });
    if (uploadError && !/already exists/i.test(uploadError.message)) {
      console.warn(
        "[account/delete] no se pudo copiar el documento heredado a almacenamiento privado:",
        uploadError.message
      );
      return null;
    }
  }

  // Compare-and-set sobre la URL original: seguro de reintentar (si ya
  // apunta al destino privado, esto no encuentra ninguna fila y es un
  // no-op) y no puede pisar una escritura concurrente de otra vía.
  const { error: updateError } = await admin
    .from("received_invoices")
    .update({ document_url: target.storageUrl })
    .eq("id", invoiceId)
    .eq("document_url", currentDocumentUrl);
  if (updateError) {
    console.warn(
      "[account/delete] no se pudo repuntar la factura al documento migrado:",
      updateError.message
    );
    return null;
  }

  return { migratedObjectPath: target.objectPath };
}

async function anonymizeRetainedRows(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[]
): Promise<{
  issuedIds: string[];
  receivedIds: string[];
  legacyReceivedInvoicePaths: Set<string>;
  retainedReceivedInvoicePaths: Set<string>;
}> {
  // deleted_by is a retry marker. Once user_id becomes null, a later attempt
  // must still rediscover fiscal rows until the durable Auth checkpoint says
  // all destructive cleanup has completed.
  const retryableOwnerFilter =
    `user_id.eq.${userId},deleted_by.eq.${userId}`;
  const { data: candidateIssuedRows, error: issuedSelectError } =
    await selectAllRows<{ id: string; status: string | null }>((from, to) =>
      admin
        .from("issued_invoices")
        .select("id, status")
        .or(retryableOwnerFilter)
        .order("id", { ascending: true })
        .range(from, to)
    );
  if (issuedSelectError && !MISSING_TABLE_CODES.has(issuedSelectError.code ?? "")) {
    errors.push({ table: "issued_invoices", message: issuedSelectError.message });
  }

  const draftIssuedIds = (candidateIssuedRows ?? [])
    .filter((row) => !isFiscallyDefinitiveIssuedInvoiceStatus(row.status))
    .map((row) => String(row.id));

  const fiscalUpdates = [
    {
      table: "issued_invoices",
      values: {
        user_id: null,
        deleted_by: userId,
        client_id: null,
        project_id: null,
        budget_id: null,
        client_email: null,
        notes: null,
      },
      statuses: FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES,
    },
    {
      table: "received_invoices",
      values: {
        user_id: null,
        deleted_by: userId,
        supplier_id: null,
        category_id: null,
        project_id: null,
        notes: null,
      },
      statuses: null,
    },
  ];
  const evidenceUpdates: { table: string; values: Record<string, unknown> }[] = [
    {
      table: "legal_acceptances",
      values: { user_id: null, ip_address: null, user_agent: null },
    },
    {
      table: "marketing_consents",
      values: { user_id: null, client_id: null, ip_address: null, user_agent: null },
    },
  ];

  for (const { table, values, statuses } of fiscalUpdates) {
    let query = admin
      .from(table)
      .update(values)
      .or(retryableOwnerFilter);
    if (statuses) query = query.in("status", [...statuses]);
    const { error } = await query;
    if (!error || MISSING_TABLE_CODES.has(error.code ?? "")) continue;

    const needsMigration = error.code === "23502" || error.code === "23503";
    const message = needsMigration
      ? `${error.message} — ${table}.user_id no admite quedarse sin titular. ` +
        `Aplica la migración ${RETENTION_MIGRATION} (user_id nullable + FK ON DELETE SET NULL).`
      : error.message;
    errors.push({ table, message });
  }

  for (const { table, values } of evidenceUpdates) {
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

  // A draft is not subject to fiscal retention. Remove its dependent content
  // explicitly before deleting the parent; this also works on schemas without
  // ON DELETE CASCADE and repairs drafts marked by an earlier partial attempt.
  if (errors.length === 0) {
    await deleteByIn(
      admin,
      "issued_invoice_lines",
      "invoice_id",
      draftIssuedIds,
      errors
    );
    await deleteByIn(
      admin,
      "fiscal_events",
      "invoice_id",
      draftIssuedIds,
      errors
    );
    await deleteByIn(admin, "issued_invoices", "id", draftIssuedIds, errors);
  }

  if (errors.length > 0) {
    return {
      issuedIds: [],
      receivedIds: [],
      legacyReceivedInvoicePaths: new Set(),
      retainedReceivedInvoicePaths: new Set(),
    };
  }

  // Stable read: after the update above, OCR promotion can no longer satisfy
  // its user_id compare-and-set. The referenced URL cannot change underneath
  // Storage cleanup.
  const { data: issuedRows, error: stableIssuedError } = await selectAllRows<{
    id: string;
  }>((from, to) =>
    admin
      .from("issued_invoices")
      .select("id")
      .eq("deleted_by", userId)
      .in("status", [...FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES])
      .order("id", { ascending: true })
      .range(from, to)
  );
  const { data: receivedRows, error: stableReceivedError } = await selectAllRows<{
    id: string;
    document_url: string | null;
  }>((from, to) =>
    admin
      .from("received_invoices")
      .select("id, document_url")
      .eq("deleted_by", userId)
      .order("id", { ascending: true })
      .range(from, to)
  );

  for (const [table, error] of [
    ["issued_invoices", stableIssuedError],
    ["received_invoices", stableReceivedError],
  ] as const) {
    if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) {
      errors.push({ table, message: error.message });
    }
  }

  const legacyReceivedInvoicePaths = new Set<string>();
  const retainedReceivedInvoicePaths = new Set<string>();
  for (const row of receivedRows ?? []) {
    const invoiceId = String(row.id);
    const storedValue = typeof row.document_url === "string" ? row.document_url : "";
    const retainedDocument = parseRetainedReceivedInvoiceDocumentUrl(
      storedValue,
      userId,
      invoiceId
    );
    if (retainedDocument) {
      retainedReceivedInvoicePaths.add(retainedDocument.objectPath);
    }

    const storageMarkers = [
      "/storage/v1/object/public/invoices/",
      "/storage/v1/object/sign/invoices/",
    ];
    let objectPath = "";
    for (const marker of storageMarkers) {
      if (!storedValue.includes(marker)) continue;
      try {
        objectPath = decodeURIComponent(
          (storedValue.split(marker)[1] || "").split("?", 1)[0]
        );
      } catch {
        objectPath = "";
      }
      break;
    }
    if (!objectPath && storedValue.startsWith(`${userId}/`)) {
      objectPath = storedValue;
    }
    if (objectPath.startsWith(`${userId}/`)) {
      // Migra el documento al bucket privado en vez de dejarlo accesible
      // públicamente para siempre. Si la migración falla en cualquier paso,
      // se conserva la exclusión del bucket público (no se pierde el
      // documento) y se reintenta en la próxima llamada.
      const migrated = await migrateLegacyReceivedInvoiceDocument(
        admin,
        userId,
        invoiceId,
        objectPath,
        storedValue
      );
      if (migrated) {
        retainedReceivedInvoicePaths.add(migrated.migratedObjectPath);
      } else {
        legacyReceivedInvoicePaths.add(objectPath);
      }
    }
  }

  return {
    issuedIds: (issuedRows ?? []).map((row) => String(row.id)),
    receivedIds: (receivedRows ?? []).map((row) => String(row.id)),
    legacyReceivedInvoicePaths,
    retainedReceivedInvoicePaths,
  };
}

async function clearFiscalRetryMarkers(
  admin: SupabaseClient,
  userId: string
): Promise<DeletionError[]> {
  const errors: DeletionError[] = [];
  for (const table of ["issued_invoices", "received_invoices"] as const) {
    const { error } = await admin
      .from(table)
      .update({ deleted_by: null })
      .eq("deleted_by", userId);
    if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) {
      errors.push({ table, message: error.message });
    }
  }
  return errors;
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

/** Borra recursivamente los ficheros del usuario bajo `${userId}/`. */
async function deleteStorageFiles(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[],
  legacyReceivedInvoicePaths: ReadonlySet<string>,
  retainedReceivedInvoicePaths: ReadonlySet<string>
) {
  for (const bucket of STORAGE_BUCKETS) {
    try {
      await deleteStorageTree(
        admin.storage.from(bucket),
        userId,
        100,
        bucket === "invoices" ? legacyReceivedInvoicePaths : new Set()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[account/delete] storage ${bucket}:`, message);
      errors.push({ table: `storage.${bucket}`, message });
    }
  }

  // This bucket also contains transient OCR drafts. Delete the entire owner
  // tree recursively, retaining only exact paths still referenced by the
  // stable fiscal rows selected above. Usually they are confirmed immutable
  // paths; an in-flight promotion fenced by deletion can leave its source draft
  // as the stable referenced document. A partial failure leaves Auth untouched,
  // so the same cleanup can safely be retried.
  try {
    await deleteStorageTree(
      admin.storage.from(RETAINED_INVOICE_BUCKET),
      userId,
      100,
      retainedReceivedInvoicePaths
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[account/delete] storage ${RETAINED_INVOICE_BUCKET}:`,
      message
    );
    errors.push({
      table: `storage.${RETAINED_INVOICE_BUCKET}`,
      message,
    });
  }
}

/**
 * Inserta el lock durable ANTES de cualquier limpieza destructiva. Nunca se
 * borra: sigue existiendo como tombstone después de eliminar Auth (ver
 * comentario de la tabla en WRITE_LOCK_MIGRATION). Devuelve cuántos leases
 * de escritura siguen activos para este usuario — si hay alguno, el
 * llamador no debe empezar a limpiar todavía (ver POST).
 */
async function lockAccountForDeletion(
  admin: SupabaseClient,
  userId: string
): Promise<{ activeLeases: number } | { error: DeletionError }> {
  const { data, error } = await admin.rpc("lock_account_for_deletion", {
    p_user_id: userId,
  });
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code ?? "")) {
      return {
        error: {
          table: "account_deletion_locks",
          message:
            `${error.message} — falta aplicar la migración ${WRITE_LOCK_MIGRATION}, ` +
            "necesaria para bloquear escrituras durante el borrado.",
        },
      };
    }
    return { error: { table: "account_deletion_locks", message: error.message } };
  }
  return { activeLeases: typeof data === "number" ? data : 0 };
}

/** n8n_updates guarda al propietario en data->>'requested_by' (jsonb), no en una columna user_id. */
async function deleteN8nUpdatesForUser(
  admin: SupabaseClient,
  userId: string,
  errors: DeletionError[]
) {
  const { error } = await admin
    .from("n8n_updates")
    .delete()
    .eq("data->>requested_by", userId);
  if (error && !IGNORABLE_CODES.has(error.code ?? "")) {
    errors.push({ table: "n8n_updates", message: error.message });
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

  // Fence new writes on every attempt, before any destructive step and
  // before the checkpoint branch below (idempotent — a retry's lock insert
  // is a no-op if the tombstone already exists). Unlike revoking the
  // user's session, this doesn't touch Auth: it only blocks writes to
  // their own rows/files via a DB trigger and Storage policies, so the
  // user can always come back with their normal cookies to retry this same
  // endpoint if a later step fails.
  const lockResult = await lockAccountForDeletion(admin, userId);
  if ("error" in lockResult) {
    console.error("[account/delete] no se pudo bloquear la cuenta:", lockResult.error);
    return NextResponse.json(
      {
        error: "No se pudo bloquear la cuenta antes de borrarla. No se ha eliminado nada.",
        details: [lockResult.error],
      },
      { status: 500 }
    );
  }
  if (lockResult.activeLeases > 0) {
    return NextResponse.json(
      {
        error:
          "Hay operaciones en curso sobre tu cuenta (por ejemplo, una subida de documento). " +
          "Tu cuenta ya ha quedado bloqueada para nuevos cambios; reinténtalo en unos segundos.",
      },
      { status: 409 }
    );
  }

  try {
    // A previous attempt may have completed every destructive cleanup step
    // and then failed while clearing markers or deleting Auth. The protected
    // Auth checkpoint makes this branch durable: never enumerate or delete
    // Storage again, because the fiscal markers may already be gone.
    if (isAccountDeletionCleanupComplete(user.app_metadata)) {
      // The write lock (inserted unconditionally above) closes most of the
      // race window. What can still slip through is a write already in
      // flight the instant the lock landed. anonymizeRetainedRows, the
      // ownership-cleanup steps, and deleteStorageFiles are all designed to
      // be safely repeated, so replay them here in the same FK-safe order
      // as the main flow instead of trusting the first pass caught
      // everything.
      const retryErrors: DeletionError[] = [];

      const {
        legacyReceivedInvoicePaths: retryLegacyPaths,
        retainedReceivedInvoicePaths: retryRetainedPaths,
      } = await anonymizeRetainedRows(admin, userId, retryErrors);
      if (retryErrors.length > 0) {
        console.error("[account/delete] reintento de anonimización:", retryErrors);
        return NextResponse.json(
          {
            error:
              "Tus datos ya están casi limpios, pero falló un reintento de anonimización. Reinténtalo.",
            details: retryErrors,
          },
          { status: 500 }
        );
      }

      const retryParentIds = {} as Record<ParentKey, string[]>;
      for (const table of PARENT_TABLES) {
        retryParentIds[table] = await collectIds(admin, table, "user_id", userId);
      }
      for (const { table, column, parent } of CHILD_TABLES) {
        await deleteByIn(admin, table, column, retryParentIds[parent], retryErrors);
      }
      for (const { table, column } of OWNED_TABLES) {
        await deleteBy(admin, table, column, userId, retryErrors);
      }
      await deletePrivatePriceBank(admin, userId, retryErrors);
      await clearAuthorReferences(admin, userId, retryErrors);
      await deleteN8nUpdatesForUser(admin, userId, retryErrors);
      if (retryErrors.length > 0) {
        console.error(
          "[account/delete] reintento de limpieza de propiedad:",
          retryErrors
        );
        return NextResponse.json(
          {
            error:
              "Tus datos ya están casi limpios, pero falló un reintento de limpieza. Reinténtalo.",
            details: retryErrors,
          },
          { status: 500 }
        );
      }

      await deleteStorageFiles(
        admin,
        userId,
        retryErrors,
        retryLegacyPaths,
        retryRetainedPaths
      );
      if (retryErrors.length > 0) {
        console.error(
          "[account/delete] reintento de limpieza de Storage:",
          retryErrors
        );
        return NextResponse.json(
          {
            error:
              "Tus datos ya están casi limpios, pero falló un reintento de limpieza de Storage. Reinténtalo.",
            details: retryErrors,
          },
          { status: 500 }
        );
      }

      const markerCleanupErrors = await clearFiscalRetryMarkers(admin, userId);
      if (markerCleanupErrors.length > 0) {
        console.error(
          "[account/delete] reintento de marcadores fiscales:",
          markerCleanupErrors
        );
        return NextResponse.json(
          {
            error:
              "La limpieza de datos terminó, pero falta desvincular algunos registros fiscales. Reinténtalo.",
            details: markerCleanupErrors,
          },
          { status: 500 }
        );
      }

      const { error: retryAuthError } = await admin.auth.admin.deleteUser(userId);
      if (retryAuthError) {
        console.error(
          "[account/delete] reintento auth.admin.deleteUser:",
          retryAuthError
        );
        return NextResponse.json(
          {
            error:
              "Tus datos ya están limpios, pero no se pudo eliminar la cuenta de acceso. Reinténtalo.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, resumed: true });
    }

    // 3) Ids de los padres, necesarios para borrar las tablas hijas.
    const parentIds = {} as Record<ParentKey, string[]>;
    for (const table of PARENT_TABLES) {
      parentIds[table] = await collectIds(admin, table, "user_id", userId);
    }

    // 4) Anonimizar lo que se conserva por obligación legal y borrar sólo las
    //    facturas emitidas que siguen siendo borradores. Va antes que el resto
    //    para liberar sus FKs; cualquier fallo deja Auth intacto y es seguro de
    //    reintentar.
    const {
      issuedIds,
      receivedIds,
      legacyReceivedInvoicePaths,
      retainedReceivedInvoicePaths,
    } = await anonymizeRetainedRows(admin, userId, errors);
    if (errors.length > 0) {
      console.error("[account/delete] errores anonimizando:", errors);
      return NextResponse.json(
        {
          error:
            "No se pudieron anonimizar los registros de conservación obligatoria. " +
            "La cuenta sigue activa y puedes reintentar.",
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
    await deleteN8nUpdatesForUser(admin, userId, errors);

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

    await deleteStorageFiles(
      admin,
      userId,
      errors,
      legacyReceivedInvoicePaths,
      retainedReceivedInvoicePaths
    );
    if (errors.length > 0) {
      return NextResponse.json(
        {
          error:
            "No se pudieron borrar todos los archivos privados. La cuenta sigue activa para poder reintentar.",
          details: errors,
        },
        { status: 500 }
      );
    }

    // 7) Perfil y usuario de auth (requiere service role).
    const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileError && !IGNORABLE_CODES.has(profileError.code ?? "")) {
      console.error("[account/delete] profiles:", profileError);
      return NextResponse.json(
        { error: "No se pudo eliminar el perfil. No se ha eliminado la cuenta." },
        { status: 500 }
      );
    }

    // Persist a protected checkpoint before clearing deleted_by. If any later
    // step fails, the next authenticated request takes the auth-only retry
    // branch above and never runs Storage cleanup with an empty allow-list.
    const { error: checkpointError } = await admin.auth.admin.updateUserById(
      userId,
      {
        app_metadata: markAccountDeletionCleanupComplete(user.app_metadata),
      }
    );
    if (checkpointError) {
      console.error("[account/delete] checkpoint Auth:", checkpointError);
      return NextResponse.json(
        {
          error:
            "Tus datos se han limpiado, pero no se pudo preparar el borrado reintentable del acceso.",
        },
        { status: 500 }
      );
    }

    // deleted_by todavía identifica al antiguo titular. Debe quedar limpio
    // ANTES de borrar Auth. El checkpoint anterior hace este paso reintentable
    // aunque una tabla falle temporalmente o Auth falle después.
    const markerCleanupErrors = await clearFiscalRetryMarkers(admin, userId);
    if (markerCleanupErrors.length > 0) {
      console.error(
        "[account/delete] no se pudieron limpiar marcadores fiscales:",
        markerCleanupErrors
      );
      return NextResponse.json(
        {
          error:
            "Tus datos se han limpiado, pero falta desvincular algunos registros fiscales. Reinténtalo.",
          details: markerCleanupErrors,
        },
        { status: 500 }
      );
    }

    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[account/delete] auth.admin.deleteUser:", authError);
      return NextResponse.json(
        {
          error:
            "Tus datos se han borrado, pero no se pudo eliminar la cuenta de acceso. Reinténtalo.",
        },
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
