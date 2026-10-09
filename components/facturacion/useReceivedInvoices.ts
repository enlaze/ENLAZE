"use client";

/**
 * Estado y operaciones de facturas recibidas.
 *
 * Es la lógica de app/dashboard/suppliers/invoices movida tal cual (carga,
 * escaneo OCR con sus borradores, alta y reintento de conservación del
 * documento), extraída a un hook porque ahora la comparten dos pestañas del
 * hub: "Recibidas" y "Escanear". El formulario es el mismo objeto de estado en
 * las dos, así que escanear en una y registrar desde la otra es continuo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { prepareInvoiceImage } from "@/lib/invoice-image-client";
import {
  getAllReceivedInvoices,
  createReceivedInvoice,
  getExpenseSummary,
  trashReceivedInvoice,
  paymentMethodLabels,
  type ReceivedInvoiceRow,
  type Supplier,
  type ExpenseSummary,
} from "@/lib/suppliers";

import {
  expenseCategoryLabels, receivedInvoiceAmounts, receivedInvoiceDateRange,
  receivedInvoiceFiscalTotals, receivedInvoicesCsv, parseVatBreakdown,
  type FiscalPeriod, type VatFormLine,
} from "@/lib/received-invoices";

type InvoiceClient = { id: string; name: string };
type InvoiceProject = { id: string; name: string; client_id: string | null };

export const emptyForm = {
  client_id: "",
  project_id: "",
  category: "general",
  invoice_number: "",
  /** Serie de la factura del proveedor; el correlativo va en invoice_number. */
  invoice_series: "",
  supplier_id: "",
  supplier_name: "",
  supplier_nif: "",
  /** Domicilio fiscal del expedidor; obligatorio en la factura completa. */
  supplier_address: "",
  issue_date: new Date().toISOString().split("T")[0],
  /** Solo si la operación es de otra fecha que la de expedición. */
  operation_date: "",
  due_date: "",
  /** Descripción de la operación facturada; la nota interna va en notes. */
  description: "",
  subtotal: "",
  iva_percent: "21",
  irpf_percent: "0",
  /** Vacío = un tipo único de IVA. Con líneas, manda el desglose. */
  vat_lines: [] as VatFormLine[],
  payment_method: "transferencia",
  notes: "",
  document_url: "",
};

export type ReceivedInvoiceForm = typeof emptyForm;

export function useReceivedInvoices(
  supplierFilter: string,
  /** Se llama tras registrar una factura (el hub lo usa para volver a la lista). */
  onRegistered?: () => void,
  initialProjectId = "",
) {
  const [supabase] = useState(() => createClient());
  const toast = useToast();
  const confirm = useConfirm();

  const [invoices, setInvoices] = useState<ReceivedInvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [projects, setProjects] = useState<InvoiceProject[]>([]);
  const [firstYear, setFirstYear] = useState(new Date().getFullYear());
  const [clientFilter, setClientFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState(initialProjectId);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [period, setPeriod] = useState<FiscalPeriod>("year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const loadVersion = useRef({ version: 0 });
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, project_id: initialProjectId });
  /** Id de la factura que se está corrigiendo; vacío cuando el alta es nueva. */
  const [editingId, setEditingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState("");
  /** Se pone a true tras un escaneo para que el hub salte a "Recibidas". */
  const [justScanned, setJustScanned] = useState(false);

  const filters = useMemo(() => ({
    status: statusFilter,
    supplier_id: supplierFilter || undefined,
    client_id: clientFilter || undefined,
    project_id: projectFilter || undefined,
    category: categoryFilter || undefined,
    search: search || undefined,
    ...receivedInvoiceDateRange(period, year, month, quarter),
  }), [statusFilter, supplierFilter, clientFilter, projectFilter, categoryFilter, search, period, year, month, quarter]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current.version;
    setLoading(true);
    setLoadError("");
    try {
      const result = await getAllReceivedInvoices(supabase, filters);
      if (version !== loadVersion.current.version) return;
      if (result.error) throw result.error;
      setInvoices(result.data);
      setTotal(result.data.length);
      setPage(0);
    } catch {
      if (version !== loadVersion.current.version) return;
      setInvoices([]);
      setTotal(0);
      setLoadError("No se pudieron cargar las facturas. Reintenta la consulta.");
    } finally {
      if (version === loadVersion.current.version) setLoading(false);
    }
  }, [supabase, filters]);

  useEffect(() => {
    const tracker = loadVersion.current;
    const t = setTimeout(load, search ? 300 : 0);
    return () => { clearTimeout(t); ++tracker.version; };
  }, [load, search]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      const [summaryResult, suppliersResult, clientsResult, projectsResult, earliestResult] = await Promise.all([
        getExpenseSummary(supabase),
        supabase.from("suppliers").select("id, name, nif").eq("status", "active").order("name"),
        supabase.from("clients").select("id, name").order("name"),
        supabase.from("projects").select("id, name, client_id").is("deleted_at", null).order("name"),
        supabase.from("received_invoices").select("issue_date").is("deleted_at", null).order("issue_date").limit(1),
      ]);
      if (!active) return;
      setSummary(summaryResult);
      setSuppliers((suppliersResult.data || []) as Supplier[]);
      setClients(clientsResult.data || []);
      setProjects(projectsResult.data || []);
      const project = projectsResult.data?.find((p) => p.id === initialProjectId);
      setForm((f) => f.project_id === initialProjectId && !f.client_id
        ? { ...f, client_id: project?.client_id || "" } : f);
      const earliest = earliestResult.data?.[0]?.issue_date;
      if (earliest) setFirstYear(Math.min(Number(earliest.slice(0, 4)), new Date().getFullYear()));
      if (clientsResult.error || projectsResult.error || suppliersResult.error) {
        toast.error("No se pudieron cargar todos los clientes, obras o proveedores");
      }
    }
    void loadOptions();
    return () => { active = false; };
  }, [supabase, initialProjectId, toast]);

  const fiscalTotals = receivedInvoiceFiscalTotals(invoices);
  const visibleInvoices = invoices.slice(page * 50, (page + 1) * 50);
  const availableYears = Array.from({ length: new Date().getFullYear() + 2 - firstYear }, (_, i) => new Date().getFullYear() + 1 - i);
  const pdfParams = new URLSearchParams({ type: "received", period, year: String(year) });
  if (period === "month") pdfParams.set("month", String(month));
  if (period === "quarter") pdfParams.set("quarter", String(quarter));
  const fiscalPdfHref = `/contabilidad-print?${pdfParams}`;

  function newForm() {
    const project = projects.find((p) => p.id === projectFilter);
    return { ...emptyForm, issue_date: new Date().toISOString().split("T")[0], project_id: project?.id || "", client_id: project?.client_id || "" };
  }

  function handleClientSelect(clientId: string) {
    setForm((f) => ({ ...f, client_id: clientId, project_id: "" }));
  }

  function handleProjectSelect(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    setForm((f) => ({ ...f, project_id: projectId, client_id: project ? project.client_id || "" : f.client_id }));
  }

  async function handleExport() {
    setExporting(true);
    try {
      // A fresh full query; never export the 50 visible rows or a stale page.
      const result = await getAllReceivedInvoices(supabase, filters);
      if (result.error) throw result.error;
      const url = URL.createObjectURL(new Blob([receivedInvoicesCsv(result.data)], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `facturas-recibidas-${filters.issue_date_from}-${filters.issue_date_to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("No se pudo exportar el conjunto completo de facturas");
    } finally {
      setExporting(false);
    }
  }

  function handleSupplierSelect(supplierId: string) {
    const s = suppliers.find((x) => x.id === supplierId);
    if (s) {
      setForm((f) => ({ ...f, supplier_id: supplierId, supplier_name: s.name, supplier_nif: s.nif || "" }));
    } else {
      setForm((f) => ({ ...f, supplier_id: "", supplier_name: "", supplier_nif: "" }));
    }
  }

  /**
   * Filtrar por cliente reajusta la obra: una obra de otro cliente dejaría la
   * lista vacía sin que se vea el motivo.
   */
  function handleClientFilter(clientId: string) {
    setClientFilter(clientId);
    setProjectFilter((current) => {
      if (!clientId || !current) return current;
      const project = projects.find((p) => p.id === current);
      return project && project.client_id === clientId ? current : "";
    });
  }

  /** Abre una factura ya registrada en el mismo formulario, para corregirla. */
  function handleEditInvoice(invoice: ReceivedInvoiceRow) {
    if (pendingInvoiceId) {
      toast.error("Hay una factura con el documento pendiente", {
        description: "Reintenta primero su conservación.",
      });
      return;
    }

    const lines = parseVatBreakdown(invoice.vat_breakdown);
    setEditingId(invoice.id);
    setForm({
      client_id: invoice.client_id || "",
      project_id: invoice.project_id || "",
      category: invoice.category || "general",
      invoice_number: invoice.invoice_number || "",
      invoice_series: invoice.invoice_series || "",
      supplier_id: invoice.supplier_id || "",
      supplier_name: invoice.supplier_name || "",
      supplier_nif: invoice.supplier_nif || "",
      supplier_address: invoice.supplier_address || "",
      issue_date: invoice.issue_date,
      operation_date: invoice.operation_date || "",
      due_date: invoice.due_date || "",
      description: invoice.description || "",
      // Con desglose, la base sale de sus líneas y el campo único no se usa.
      subtotal: lines.length > 0 ? "" : String(invoice.subtotal ?? ""),
      iva_percent: String(invoice.iva_percent ?? 21),
      irpf_percent: String(invoice.irpf_percent ?? 0),
      vat_lines: lines.map((line) => ({ base: String(line.base), rate: String(line.rate) })),
      payment_method: invoice.payment_method || "transferencia",
      notes: invoice.notes || "",
      // Se arrastra tal cual: el documento conservado no se reescribe desde el
      // navegador, ni al corregir ni al reintentar.
      document_url: invoice.document_url || "",
    });
    setShowForm(true);
    // La tabla puede ser larga: si no, el formulario se abre fuera de la vista
    // y parece que el botón no ha hecho nada.
    if (typeof document !== "undefined") {
      setTimeout(() => {
        document
          .getElementById("received-invoice-form")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
  }

  /** Papelera, no borrado: la factura se conserva y se puede recuperar. */
  async function handleDeleteInvoice(invoice: ReceivedInvoiceRow) {
    const ok = await confirm({
      title: "Mover factura recibida a la papelera",
      description: `${invoice.invoice_number} de ${invoice.supplier_name}. Se conservará y podrás recuperarla desde Papelera.`,
      variant: "danger",
      confirmLabel: "Mover a la papelera",
    });
    if (!ok) return;

    setDeletingId(invoice.id);
    const { moved, error } = await trashReceivedInvoice(supabase, invoice.id);
    if (error || !moved) {
      toast.error("No se pudo mover la factura a la papelera");
      setDeletingId("");
      return;
    }

    // Si era la que estaba abierta, el formulario ya no tiene a qué apuntar.
    if (editingId === invoice.id) {
      setEditingId("");
      setShowForm(false);
      setForm(newForm());
    }
    toast.success("Factura movida a la papelera", {
      description: "Puedes recuperarla desde Papelera.",
    });
    await load();
    setSummary(await getExpenseSummary(supabase));
    setDeletingId("");
  }

  const isOcrDraftUrl = (value: string) =>
    value.startsWith("storage://received-invoice-documents/") &&
    value.includes("/drafts/");

  async function deleteOcrDraft(draftUrl: string) {
    const response = await fetch("/api/invoices/ocr", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_url: draftUrl }),
    });
    if (response.ok) return;

    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "No se pudo eliminar el borrador OCR");
  }

  async function promoteOcrDraft(draftUrl: string, invoiceId: string) {
    const response = await fetch("/api/invoices/ocr", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_url: draftUrl, invoice_id: invoiceId }),
    });
    if (response.ok) return;

    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.error || "No se pudo conservar el documento de la factura"
    );
  }

  async function handleNewInvoice() {
    if (pendingInvoiceId) {
      toast.error("La factura ya está registrada", {
        description: "Reintenta primero la conservación de su documento.",
      });
      return;
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await deleteOcrDraft(form.document_url);
      } catch (error) {
        toast.error("No se pudo descartar el borrador", {
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        });
        return;
      }
    }

    setEditingId("");
    setForm(newForm());
    setShowForm(true);
  }

  async function handleCancelForm() {
    if (pendingInvoiceId) {
      toast.error("La factura ya está registrada", {
        description: "Reintenta primero la conservación de su documento.",
      });
      return;
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await deleteOcrDraft(form.document_url);
      } catch (error) {
        toast.error("No se pudo descartar el borrador", {
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        });
        return;
      }
    }

    setEditingId("");
    setForm(newForm());
    setShowForm(false);
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingInvoiceId) {
      toast.error("Reintenta primero la conservación de la factura registrada");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona una foto JPG, PNG o WEBP");
      return;
    }

    setScanning(true);
    try {
      const optimizedFile = await prepareInvoiceImage(file);
      const body = new FormData();
      body.append("file", optimizedFile);
      body.append("mode", "extract");

      const response = await fetch("/api/invoices/ocr", {
        method: "POST",
        body,
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json()
        : { error: `El servidor devolvió un error ${response.status}` };

      if (!response.ok || !result.success || !result.ocr_data) {
        throw new Error(result.error || "No se pudo analizar la factura");
      }

      const newDraftUrl = String(result.image_url || "");
      const previousDraftUrl = isOcrDraftUrl(form.document_url)
        ? form.document_url
        : "";
      if (previousDraftUrl && previousDraftUrl !== newDraftUrl) {
        try {
          await deleteOcrDraft(previousDraftUrl);
        } catch (cleanupError) {
          // Keep the previous form usable. The newly uploaded draft is not
          // exposed to the UI unless the replacement can be completed.
          await deleteOcrDraft(newDraftUrl).catch(() => {});
          throw cleanupError;
        }
      }

      const data = result.ocr_data as Record<string, unknown>;
      const supplierName = String(data.supplier_name || "");
      const supplierNif = String(data.supplier_nif || "");
      const normalizedNif = supplierNif.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const normalizedName = supplierName.trim().toLocaleLowerCase("es");
      const matchingSupplier = suppliers.find((supplier) => {
        const candidateNif = (supplier.nif || "")
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase();
        return (
          (normalizedNif && candidateNif === normalizedNif) ||
          (normalizedName &&
            supplier.name.trim().toLocaleLowerCase("es") === normalizedName)
        );
      });
      const paymentMethod = String(data.payment_method || "").toLowerCase();

      setForm({
        ...newForm(),
        ...(showForm ? { client_id: form.client_id, project_id: form.project_id } : {}),
        category: expenseCategoryLabels[String(data.category)] ? String(data.category) : "general",
        invoice_number: String(data.invoice_number || ""),
        supplier_id: matchingSupplier?.id || "",
        supplier_name: matchingSupplier?.name || supplierName,
        supplier_nif: matchingSupplier?.nif || supplierNif,
        issue_date:
          String(data.invoice_date || "") ||
          new Date().toISOString().split("T")[0],
        due_date: String(data.due_date || ""),
        subtotal: String(Number(data.base_amount || 0) || ""),
        iva_percent: String(Number(data.iva_percentage ?? 21)),
        irpf_percent: String(Number(data.irpf_percentage ?? 0)),
        payment_method: paymentMethodLabels[paymentMethod]
          ? paymentMethod
          : "transferencia",
        notes: String(data.notes || ""),
        document_url: newDraftUrl,
      });
      setShowForm(true);
      setJustScanned(true);
      toast.success("Factura analizada", {
        description: "Revisa los datos antes de registrarla.",
      });
    } catch (error) {
      toast.error("No se pudo analizar la factura", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
      });
    } finally {
      setScanning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // Con desglose por tipos manda la suma de sus líneas; con un tipo único,
    // el cálculo de siempre. Vive en lib para poder probar el redondeo aparte.
    const { subtotal, ivaPct, ivaAmount, irpfPct, irpfAmount, total: totalAmount, breakdown } =
      receivedInvoiceAmounts(form);

    // Corregir una factura y reintentar la conservación del documento de una
    // recién creada son la misma escritura: un único RPC con todo el contenido.
    const correcting = Boolean(editingId || pendingInvoiceId);
    let invoiceId = editingId || pendingInvoiceId;

    if (!invoiceId) {
      const { data, error } = await createReceivedInvoice(supabase, {
        client_id: form.client_id || null,
        project_id: form.project_id || null,
        category: form.category,
        invoice_number: form.invoice_number,
        invoice_series: form.invoice_series.trim() || null,
        supplier_id: form.supplier_id || null,
        supplier_name: form.supplier_name,
        supplier_nif: form.supplier_nif || null,
        supplier_address: form.supplier_address.trim() || null,
        issue_date: form.issue_date,
        operation_date: form.operation_date || null,
        due_date: form.due_date || null,
        description: form.description.trim() || null,
        subtotal,
        iva_percent: ivaPct,
        iva_amount: ivaAmount,
        irpf_percent: irpfPct,
        irpf_amount: irpfAmount,
        total: totalAmount,
        vat_breakdown: breakdown,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
        document_url: form.document_url || null,
      });

      if (error || !data) {
        toast.error("Error al registrar la factura");
        setSaving(false);
        return;
      }
      invoiceId = data.id;
      if (isOcrDraftUrl(form.document_url)) {
        setPendingInvoiceId(invoiceId);
      }
    } else {
      // Dos caminos llegan aquí: corregir una factura ya registrada, y el
      // reintento de una recién creada cuya conservación de documento falló
      // (ahí, además, hay que no perder las correcciones hechas mientras).
      //
      // Todo el contenido va en el MISMO RPC, bajo un solo bloqueo de fila:
      // antes cliente, obra y categoría se guardaban en un UPDATE aparte que
      // podía fallar por su cuenta y dejar la factura a medio corregir.
      // document_url no viaja: el documento solo lo escribe el servidor.
      const { error } = await supabase.rpc("update_received_invoice_and_reconcile", {
        p_invoice_id: invoiceId,
        p_invoice_number: form.invoice_number,
        p_supplier_id: form.supplier_id || null,
        p_supplier_name: form.supplier_name,
        p_supplier_nif: form.supplier_nif || null,
        p_issue_date: form.issue_date,
        p_due_date: form.due_date || null,
        p_subtotal: subtotal,
        p_iva_percent: ivaPct,
        p_iva_amount: ivaAmount,
        p_irpf_percent: irpfPct,
        p_irpf_amount: irpfAmount,
        p_total: totalAmount,
        p_payment_method: form.payment_method || null,
        p_notes: form.notes || null,
        p_client_id: form.client_id || null,
        p_project_id: form.project_id || null,
        p_category: form.category,
        p_invoice_series: form.invoice_series.trim() || null,
        p_operation_date: form.operation_date || null,
        p_supplier_address: form.supplier_address.trim() || null,
        p_description: form.description.trim() || null,
        p_vat_breakdown: breakdown,
      });

      if (error) {
        toast.error("No se pudieron guardar las correcciones", {
          description: pendingInvoiceId
            ? "Reintenta antes de conservar el documento."
            : "Vuelve a intentarlo.",
        });
        setSaving(false);
        return;
      }
    }

    if (isOcrDraftUrl(form.document_url)) {
      try {
        await promoteOcrDraft(form.document_url, invoiceId);
      } catch (error) {
        toast.error("Factura registrada; documento pendiente", {
          description:
            (error instanceof Error ? error.message : "Error de conservación") +
            ". Pulsa de nuevo para reintentar sin crear otra factura.",
        });
        setSaving(false);
        return;
      }
    }

    setPendingInvoiceId("");
    setEditingId("");
    toast.success(correcting ? "Factura actualizada" : "Factura registrada");
    setForm(newForm());
    setShowForm(false);
    setJustScanned(false);
    await load();
    setSummary(await getExpenseSummary(supabase));
    setSaving(false);
    onRegistered?.();
  }

  return {
    invoices, visibleInvoices, suppliers, clients, projects, summary, total, loading, loadError,
    clientFilter, handleClientFilter, editingId, deletingId,
    handleEditInvoice, handleDeleteInvoice,
    projectFilter, setProjectFilter, categoryFilter, setCategoryFilter,
    period, setPeriod, year, setYear, month, setMonth, quarter, setQuarter, availableYears,
    page, setPage, fiscalTotals, fiscalPdfHref, exporting, handleExport,
    handleClientSelect, handleProjectSelect,
    search, setSearch, statusFilter, setStatusFilter,
    showForm, setShowForm, form, setForm, saving, scanning, pendingInvoiceId,
    justScanned, setJustScanned,
    load, handleSupplierSelect, handleScan, handleSubmit, handleNewInvoice, handleCancelForm,
  };
}

export type ReceivedInvoicesState = ReturnType<typeof useReceivedInvoices>;
