"use client";

/**
 * Recordatorio de cobro de una factura vencida.
 *
 * Dos mitades, a propósito:
 *  - Envío MANUAL: funciona hoy, reutilizando /api/send-email (el mismo envío
 *    por Gmail que ya usa el resto del panel). No inventa canal nuevo.
 *  - Auto-cobro: es el hueco de la fase 2. Se enseña el gesto y lo que hará,
 *    desactivado, para que el motor de automatización solo tenga que
 *    enchufarse aquí — no se guarda ningún estado todavía.
 */

import { useState } from "react";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-fields";
import { useToast } from "@/components/ui/toast";
import { daysSince, eur, type IssuedInvoice } from "./shared";

function defaultSubject(inv: IssuedInvoice) {
  return `Recordatorio de la factura ${inv.invoice_number}`;
}

function defaultMessage(inv: IssuedInvoice) {
  const dias = inv.due_date ? daysSince(inv.due_date) : 0;
  return [
    `Hola${inv.clients?.name || inv.client_name ? ` ${inv.clients?.name || inv.client_name}` : ""},`,
    "",
    `Te escribo por la factura ${inv.invoice_number}, de ${eur(inv.total)}, que venció hace ${dias} día${dias === 1 ? "" : "s"} y todavía figura como pendiente de cobro.`,
    "",
    "Si ya la has pagado, dime por dónde y la marco como cobrada. Si no, ¿me confirmas una fecha?",
    "",
    "Gracias.",
  ].join("\n");
}

/**
 * El borrador (destinatario, asunto y cuerpo) se rellena a partir de la
 * factura. Antes eso lo hacía un efecto que llamaba a tres `setState` en su
 * cuerpo: React lo desaconseja (renderizado en cascada) y ESLint lo marcaba
 * con `react-hooks/set-state-in-effect`.
 *
 * En vez de un efecto, el estado nace ya con el valor bueno y el diálogo se
 * remonta al cambiar de factura, gracias a la `key` de abajo. El
 * comportamiento es el mismo que antes: abrir el diálogo —o cambiar de
 * factura sin cerrarlo— repone el borrador; mientras está abierto, lo que
 * escriba el usuario se conserva.
 */
function ReminderForm({
  invoice,
  onClose,
}: {
  invoice: IssuedInvoice;
  onClose: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState(() => invoice.clients?.email || invoice.client_email || "");
  const [subject, setSubject] = useState(() => defaultSubject(invoice));
  const [message, setMessage] = useState(() => defaultMessage(invoice));
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!to.trim()) {
      toast.error("Falta el email del cliente", {
        description: "Añádelo aquí o en la ficha del cliente.",
      });
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, message }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo enviar el recordatorio");
      }
      toast.success("Recordatorio enviado", { description: `A ${to}` });
      onClose();
    } catch (error) {
      toast.error("No se pudo enviar el recordatorio", {
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} widthClass="max-w-lg" labelledBy="reminder-title" describedBy="reminder-desc">
      <DialogHeader>
        <DialogTitle id="reminder-title">Reclamar {invoice.invoice_number}</DialogTitle>
        <DialogDescription id="reminder-desc">
          {eur(invoice.total)} · vencida hace {invoice.due_date ? daysSince(invoice.due_date) : 0} días
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <FormField label="Para">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@empresa.com" type="email" />
        </FormField>
        <FormField label="Asunto">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Mensaje">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            className="w-full rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm leading-relaxed text-navy-900 placeholder:text-navy-400 focus:border-brand-green focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
          />
        </FormField>

        {/* Hueco de la fase 2: el gesto existe, el motor llega después. */}
        <div className="rounded-xl border border-dashed border-brand-green/40 bg-brand-green/5 p-4 dark:bg-brand-green/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-white">
                Recordatorio automático
                <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-green">
                  Pronto
                </span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-navy-600 dark:text-zinc-400">
                Enlaze reenviará este recordatorio cada 7 días hasta que marques la factura como
                cobrada. Se activará cuando conectemos el motor de automatización.
              </p>
            </div>
            <span
              aria-hidden
              className="mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-navy-200 p-0.5 opacity-60 dark:bg-zinc-700"
            >
              <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
            </span>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={sending}>
          Cancelar
        </Button>
        <Button onClick={handleSend} loading={sending} disabled={sending}>
          {sending ? "Enviando..." : "Enviar recordatorio"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default function ReminderDialog({
  invoice,
  onClose,
}: {
  invoice: IssuedInvoice | null;
  onClose: () => void;
}) {
  if (!invoice) return null;
  // La `key` es la que repone el borrador al saltar de una factura a otra.
  return <ReminderForm key={invoice.id} invoice={invoice} onClose={onClose} />;
}
