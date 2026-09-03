/* eslint-disable react-hooks/set-state-in-effect */
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

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { prepareInvoiceImage } from "@/lib/invoice-image-client";
import {
  getReceivedInvoices,
  createReceivedInvoice,
  getExpenseSummary,
  paymentMethodLabels,
  type ReceivedInvoice,
  type Supplier,
  type ExpenseSummary,
} from "@/lib/suppliers";

export const emptyForm = {
  invoice_number: "",
  supplier_id: "",
  supplier_name: "",
  supplier_nif: "",
  issue_date: new Date().toISOString().split("T")[0],
  due_date: "",
  subtotal: "",
  iva_percent: "21",
  irpf_percent: "0",
  payment_method: "transferencia",
  notes: "",
  document_url: "",
};

export type ReceivedInvoiceForm = typeof emptyForm;

export function useReceivedInvoices(
  supplierFilter: string,
  /** Se llama tras registrar una factura (el hub lo usa para volver a la lista). */
  onRegistered?: () => void,
) {
  const [supabase] = useState(() => createClient());
  const toast = useToast();

  const [invoices, setInvoices] = useState<ReceivedInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState("");
  /** Se pone a true tras un escaneo para que el hub salte a "Recibidas". */
  const [justScanned, setJustScanned] = useState(false);

  const load = useCallback(async () => {
    const [invoiceResult, summaryResult, suppliersResult] = await Promise.all([
      getReceivedInvoices(supabase, {
        status: statusFilter,
        supplier_id: supplierFilter || undefined,
        search: search || undefined,
        limit: 50,
      }),
      getExpenseSummary(supabase),
      supabase.from("suppliers").select("id, name, nif").eq("status", "active").order("name"),
    ]);

    setInvoices(invoiceResult.data);
    setTotal(invoiceResult.count);
    setSummary(summaryResult);
    setSuppliers((suppliersResult.data || []) as Supplier[]);
    setLoading(false);
  }, [search, statusFilter, supabase, supplierFilter]);

  useEffect(() => {
    // `search` se pasa a la misma consulta de siempre (getReceivedInvoices);
    // aquí solo se le pone un respiro para no lanzar una petición por tecla.
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [statusFilter, supplierFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSupplierSelect(supplierId: string) {
    const s = suppliers.find((x) => x.id === supplierId);
    if (s) {
      setForm((f) => ({ ...f, supplier_id: supplierId, supplier_name: s.name, supplier_nif: s.nif || "" }));
    } else {
      setForm((f) => ({ ...f, supplier_id: "", supplier_name: "", supplier_nif: "" }));
    }
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

    setForm(emptyForm);
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

    setForm(emptyForm);
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

    const subtotal = parseFloat(form.subtotal) || 0;
    const ivaPct = parseFloat(form.iva_percent) || 0;
    const irpfPct = parseFloat(form.irpf_percent) || 0;
    const ivaAmount = subtotal * (ivaPct / 100);
    const irpfAmount = subtotal * (irpfPct / 100);
    const totalAmount = subtotal + ivaAmount - irpfAmount;

    let invoiceId = pendingInvoiceId;

    if (!invoiceId) {
      const { data, error } = await createReceivedInvoice(supabase, {
        invoice_number: form.invoice_number,
        supplier_id: form.supplier_id || null,
        supplier_name: form.supplier_name,
        supplier_nif: form.supplier_nif || null,
        issue_date: form.issue_date,
        due_date: form.due_date || null,
        subtotal,
        iva_percent: ivaPct,
        iva_amount: ivaAmount,
        irpf_percent: irpfPct,
        irpf_amount: irpfAmount,
        total: totalAmount,
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
      // A previous submit already created the invoice and only failed while
      // retrying OCR promotion below. Persist any corrections made to the
      // form in the meantime, or they are silently discarded once this
      // retry succeeds and the form closes.
      //
      // The invoice UPDATE and the suppliers.total_invoiced adjustment run
      // as ONE atomic RPC instead of two separate client calls: the RPC
      // re-reads the invoice's pre-edit supplier/total itself (under a row
      // lock) at write time, so the delta is always computed from the true
      // current DB state — a best-effort follow-up call that only logs on
      // failure could leave the invoice corrected but the supplier balance
      // stale, with no retry path (a later retry re-reads the already-
      // corrected invoice and sees a zero delta).
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
      });

      if (error) {
        toast.error("No se pudieron guardar las correcciones", {
          description: "Reintenta antes de conservar el documento.",
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
    toast.success("Factura registrada");
    setForm(emptyForm);
    setShowForm(false);
    setJustScanned(false);
    await load();
    setSaving(false);
    onRegistered?.();
  }

  return {
    invoices, suppliers, summary, total, loading,
    search, setSearch, statusFilter, setStatusFilter,
    showForm, setShowForm, form, setForm, saving, scanning, pendingInvoiceId,
    justScanned, setJustScanned,
    load, handleSupplierSelect, handleScan, handleSubmit, handleNewInvoice, handleCancelForm,
  };
}

export type ReceivedInvoicesState = ReturnType<typeof useReceivedInvoices>;
