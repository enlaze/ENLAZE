"use client";

/**
 * Formulario de alta de factura recibida — el mismo que había en
 * app/dashboard/suppliers/invoices, ahora compartido por las pestañas
 * "Recibidas" (alta manual) y "Escanear" (alta con los datos ya rellenados
 * por el OCR).
 */

import { FactCard } from "./ui";
import { expenseCategoryLabels } from "@/lib/received-invoices";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { paymentMethodLabels } from "@/lib/suppliers";
import type { ReceivedInvoicesState } from "./useReceivedInvoices";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);

export default function ReceivedInvoiceForm({
  state,
  title = "Registrar factura recibida",
}: {
  state: ReceivedInvoicesState;
  title?: string;
}) {
  const { form, setForm, suppliers, clients, projects, handleClientSelect, handleProjectSelect, saving, pendingInvoiceId, handleSupplierSelect, handleSubmit, handleCancelForm } = state;

  const computedSubtotal = parseFloat(form.subtotal) || 0;
  const computedIva = computedSubtotal * ((parseFloat(form.iva_percent) || 0) / 100);
  const computedIrpf = computedSubtotal * ((parseFloat(form.irpf_percent) || 0) / 100);
  const computedTotal = computedSubtotal + computedIva - computedIrpf;

  return (
    <FactCard className="mb-6">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-green">{title}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="Nº de factura" required>
            <Input
              value={form.invoice_number}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              required
              placeholder="F-2024/001"
            />
          </FormField>
          <FormField label="Proveedor">
            <Select
              value={form.supplier_id}
              onChange={(e) => handleSupplierSelect(e.target.value)}
            >
              <option value="">— Seleccionar proveedor —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Nombre proveedor" required>
            <Input
              value={form.supplier_name}
              onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
              required
              placeholder="Nombre del proveedor"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="Cliente">
            <Select aria-label="Cliente de la factura" value={form.client_id} onChange={(e) => handleClientSelect(e.target.value)}>
              <option value="">Sin cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Obra">
            <Select aria-label="Obra de la factura" value={form.project_id} onChange={(e) => handleProjectSelect(e.target.value)}>
              <option value="">Sin obra</option>
              {projects.filter((p) => !form.client_id || p.client_id === form.client_id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Categoría de gasto">
            <Select aria-label="Categoría de gasto" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(expenseCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField label="NIF proveedor">
            <Input
              value={form.supplier_nif}
              onChange={(e) => setForm({ ...form, supplier_nif: e.target.value })}
              placeholder="B12345678"
            />
          </FormField>
          <FormField label="Fecha emisión" required>
            <Input
              type="date"
              value={form.issue_date}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Fecha vencimiento">
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </FormField>
          <FormField label="Forma de pago">
            <Select
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              {Object.entries(paymentMethodLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField label="Base imponible (€)" required>
            <Input
              type="number"
              step="0.01"
              value={form.subtotal}
              onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
              required
              placeholder="0.00"
            />
          </FormField>
          <FormField label="IVA (%)">
            <Input
              type="number"
              step="0.01"
              value={form.iva_percent}
              onChange={(e) => setForm({ ...form, iva_percent: e.target.value })}
            />
          </FormField>
          <FormField label="IRPF (%)">
            <Input
              type="number"
              step="0.01"
              value={form.irpf_percent}
              onChange={(e) => setForm({ ...form, irpf_percent: e.target.value })}
            />
          </FormField>
          <div className="flex flex-col justify-center rounded-xl bg-navy-50/60 p-3 dark:bg-zinc-900/50">
            <p className="text-xs text-navy-500 dark:text-zinc-400">IVA: {fmtMoney(computedIva)}</p>
            <p className="text-xs text-navy-500 dark:text-zinc-400">IRPF: -{fmtMoney(computedIrpf)}</p>
            <p className="text-sm font-bold text-navy-900 dark:text-white">Total: {fmtMoney(computedTotal)}</p>
          </div>
        </div>

        <FormField label="Notas">
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Concepto, referencia..."
          />
        </FormField>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving
              ? "Guardando..."
              : pendingInvoiceId
                ? "Reintentar conservación"
                : "Registrar factura"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleCancelForm} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </form>
    </FactCard>
  );
}
