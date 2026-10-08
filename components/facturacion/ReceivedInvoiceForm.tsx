"use client";

/**
 * Formulario de factura recibida — alta, alta con datos del OCR y corrección
 * de una factura ya registrada. Es el mismo objeto de estado en las pestañas
 * "Recibidas" y "Escanear", así que escanear en una y guardar desde la otra es
 * continuo, y corregir reutiliza este mismo formulario en lugar de otro.
 *
 * Los campos de la mitad de abajo son el contenido obligatorio de la factura
 * (art. 6 del RD 1619/2012, recogido en el manual de IVA de la AEAT): serie,
 * fecha de la operación cuando no coincide con la de expedición, domicilio
 * fiscal del expedidor, descripción de la operación y los tipos de IVA con su
 * cuota. Ninguno bloquea el guardado: lo que falte sale avisado, porque el
 * arreglo está en pedirle al proveedor una factura correcta, no en impedir
 * registrar la que ya ha llegado.
 */

import { FactCard } from "./ui";
import {
  expenseCategoryLabels,
  receivedInvoiceAmounts,
  receivedInvoiceComplianceIssues,
  type VatFormLine,
} from "@/lib/received-invoices";
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
  const { form, setForm, suppliers, clients, projects, handleClientSelect, handleProjectSelect, saving, pendingInvoiceId, editingId, handleSupplierSelect, handleSubmit, handleCancelForm } = state;

  // El formulario se renderiza también con un estado parcial (pruebas y la
  // pestaña de escaneo antes de su primera carga), así que nada se da por hecho.
  const vatLines: VatFormLine[] = form.vat_lines || [];
  const splitVat = vatLines.length > 0;
  const text = (value: string | undefined) => value ?? "";

  const amounts = receivedInvoiceAmounts({
    subtotal: text(form.subtotal),
    iva_percent: text(form.iva_percent),
    irpf_percent: text(form.irpf_percent),
    vat_lines: vatLines,
  });

  // En un formulario aún en blanco el aviso sobraría: todo está «por rellenar»,
  // no «mal». Aparece en cuanto hay algo que juzgar.
  const started = Boolean(
    form.invoice_number || form.supplier_name || form.subtotal || vatLines.length > 0 || editingId,
  );
  const issues = receivedInvoiceComplianceIssues({
    invoice_number: text(form.invoice_number),
    supplier_name: text(form.supplier_name),
    supplier_nif: text(form.supplier_nif),
    supplier_address: text(form.supplier_address),
    description: text(form.description),
    subtotal: amounts.subtotal,
    iva_percent: amounts.ivaPct,
    iva_amount: amounts.ivaAmount,
    vat_breakdown: amounts.breakdown,
  });

  function setLines(lines: VatFormLine[]) {
    setForm({ ...form, vat_lines: lines });
  }

  /** Al desglosar, la primera línea arranca con lo ya escrito arriba. */
  function startSplit() {
    setLines([
      { base: text(form.subtotal) || "", rate: text(form.iva_percent) || "21" },
      { base: "", rate: "10" },
    ]);
  }

  /** Al volver al tipo único, la base recupera la suma del desglose. */
  function stopSplit() {
    setForm({
      ...form,
      subtotal: amounts.subtotal ? String(amounts.subtotal) : text(form.subtotal),
      iva_percent: text(form.iva_percent) || "21",
      vat_lines: [],
    });
  }

  const title_ = editingId ? "Corregir factura recibida" : title;

  return (
    <FactCard className="mb-6">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-green">{title_}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField label="Serie">
            <Input
              value={text(form.invoice_series)}
              onChange={(e) => setForm({ ...form, invoice_series: e.target.value })}
              placeholder="A"
            />
          </FormField>
          <FormField label="Nº de factura" required>
            <Input
              value={text(form.invoice_number)}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              required
              placeholder="F-2024/001"
            />
          </FormField>
          <FormField label="Proveedor">
            <Select
              value={text(form.supplier_id)}
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
              value={text(form.supplier_name)}
              onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
              required
              placeholder="Nombre del proveedor"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="Cliente">
            <Select aria-label="Cliente de la factura" value={text(form.client_id)} onChange={(e) => handleClientSelect(e.target.value)}>
              <option value="">Sin cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Obra">
            <Select aria-label="Obra de la factura" value={text(form.project_id)} onChange={(e) => handleProjectSelect(e.target.value)}>
              <option value="">Sin obra</option>
              {projects.filter((p) => !form.client_id || p.client_id === form.client_id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Categoría de gasto">
            <Select aria-label="Categoría de gasto" value={text(form.category)} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(expenseCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="NIF proveedor">
            <Input
              value={text(form.supplier_nif)}
              onChange={(e) => setForm({ ...form, supplier_nif: e.target.value })}
              placeholder="B12345678"
            />
          </FormField>
          <FormField label="Domicilio fiscal del proveedor">
            <Input
              value={text(form.supplier_address)}
              onChange={(e) => setForm({ ...form, supplier_address: e.target.value })}
              placeholder="Calle, número, código postal y población"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField label="Fecha emisión" required>
            <Input
              type="date"
              value={text(form.issue_date)}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Fecha de la operación">
            <Input
              type="date"
              aria-label="Fecha de la operación si es distinta de la de emisión"
              value={text(form.operation_date)}
              onChange={(e) => setForm({ ...form, operation_date: e.target.value })}
            />
          </FormField>
          <FormField label="Fecha vencimiento">
            <Input
              type="date"
              value={text(form.due_date)}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </FormField>
          <FormField label="Forma de pago">
            <Select
              value={text(form.payment_method)}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              {Object.entries(paymentMethodLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Descripción de la operación">
          <Input
            value={text(form.description)}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Qué se ha comprado o qué servicio se ha prestado"
          />
        </FormField>

        {/* Importes: un tipo único, o el desglose cuando la factura trae varios. */}
        {!splitVat ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <FormField label="Base imponible (€)" required>
              <Input
                type="number"
                step="0.01"
                value={text(form.subtotal)}
                onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                required
                placeholder="0.00"
              />
            </FormField>
            <FormField label="IVA (%)">
              <Input
                type="number"
                step="0.01"
                value={text(form.iva_percent)}
                onChange={(e) => setForm({ ...form, iva_percent: e.target.value })}
              />
            </FormField>
            <FormField label="IRPF (%)">
              <Input
                type="number"
                step="0.01"
                value={text(form.irpf_percent)}
                onChange={(e) => setForm({ ...form, irpf_percent: e.target.value })}
              />
            </FormField>
            <div className="flex flex-col justify-center rounded-xl bg-navy-50/60 p-3 dark:bg-zinc-900/50">
              <p className="text-xs text-navy-500 dark:text-zinc-400">IVA: {fmtMoney(amounts.ivaAmount)}</p>
              <p className="text-xs text-navy-500 dark:text-zinc-400">IRPF: -{fmtMoney(amounts.irpfAmount)}</p>
              <p className="text-sm font-bold text-navy-900 dark:text-white">Total: {fmtMoney(amounts.total)}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-navy-100 p-4 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
              Desglose por tipos de IVA
            </p>
            {vatLines.map((line, index) => {
              const base = parseFloat(line.base) || 0;
              const rate = parseFloat(line.rate) || 0;
              return (
                <div key={index} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
                  <FormField label={`Base ${index + 1} (€)`}>
                    <Input
                      type="number"
                      step="0.01"
                      aria-label={`Base imponible al tipo ${index + 1}`}
                      value={line.base}
                      onChange={(e) =>
                        setLines(vatLines.map((l, i) => (i === index ? { ...l, base: e.target.value } : l)))
                      }
                      placeholder="0.00"
                    />
                  </FormField>
                  <FormField label="Tipo (%)">
                    <Input
                      type="number"
                      step="0.01"
                      aria-label={`Tipo de IVA ${index + 1}`}
                      value={line.rate}
                      onChange={(e) =>
                        setLines(vatLines.map((l, i) => (i === index ? { ...l, rate: e.target.value } : l)))
                      }
                      placeholder="21"
                    />
                  </FormField>
                  <div className="rounded-xl bg-navy-50/60 p-3 text-xs text-navy-500 dark:bg-zinc-900/50 dark:text-zinc-400">
                    Cuota: {fmtMoney(Math.round(base * rate) / 100)}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={vatLines.length <= 1}
                    onClick={() => setLines(vatLines.filter((_, i) => i !== index))}
                  >
                    Quitar tipo
                  </Button>
                </div>
              );
            })}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <FormField label="IRPF (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={text(form.irpf_percent)}
                  onChange={(e) => setForm({ ...form, irpf_percent: e.target.value })}
                />
              </FormField>
              <div className="flex flex-col justify-center rounded-xl bg-navy-50/60 p-3 md:col-span-2 dark:bg-zinc-900/50">
                <p className="text-xs text-navy-500 dark:text-zinc-400">
                  Base imponible: {fmtMoney(amounts.subtotal)} · IVA: {fmtMoney(amounts.ivaAmount)}
                </p>
                <p className="text-xs text-navy-500 dark:text-zinc-400">IRPF: -{fmtMoney(amounts.irpfAmount)}</p>
                <p className="text-sm font-bold text-navy-900 dark:text-white">Total: {fmtMoney(amounts.total)}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setLines([...vatLines, { base: "", rate: "21" }])}>
                Añadir tipo
              </Button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={splitVat ? stopSplit : startSplit}
          className="text-xs font-semibold text-success-ink underline-offset-2 hover:underline"
        >
          {splitVat ? "Volver a un tipo único de IVA" : "La factura tiene varios tipos de IVA"}
        </button>

        <FormField label="Notas internas">
          <Input
            value={text(form.notes)}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Referencia, observaciones..."
          />
        </FormField>

        {started && issues.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-ink">
            <p className="font-semibold">Con estos datos el IVA no sería deducible:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            <p className="mt-1">
              Puedes guardarla igual y quedará marcada hasta que el proveedor envíe la factura completa.
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving
              ? "Guardando..."
              : pendingInvoiceId
                ? "Reintentar conservación"
                : editingId
                  ? "Guardar cambios"
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
