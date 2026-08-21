"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase-browser";
import {
  defaultPaymentSchedule,
  type PaymentPhase,
  useBudgetGenerate,
} from "./BudgetGenerateProvider";

const paymentMethodQuickOptions = [
  "Transferencia bancaria",
  "Bizum",
  "Efectivo",
  "Tarjeta",
  "A convenir",
];

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none dark:bg-zinc-900 dark:text-white dark:border-zinc-700 text-sm";
const inputSmCls =
  "w-full bg-white text-navy-900 rounded-lg px-3 py-2 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none text-sm dark:bg-zinc-900 dark:text-white dark:border-zinc-700";
const labelCls = "block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1";

export function BudgetTermsFields() {
  const { state, updateState } = useBudgetGenerate();
  const [fiscalIban, setFiscalIban] = useState("");

  useEffect(() => {
    let active = true;
    async function loadFiscalIban() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("fiscal_settings")
        .select("iban")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active) return;
      const iban = data?.iban || "";
      setFiscalIban(iban);
      if (iban && !state.paymentIban) updateState({ paymentIban: iban });
    }
    loadFiscalIban();
    return () => { active = false; };
    // The default IBAN is loaded once when this step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updatePaymentPhase(index: number, field: keyof PaymentPhase, value: string | number) {
    const schedule = state.paymentSchedule.map((phase, phaseIndex) =>
      phaseIndex === index ? { ...phase, [field]: value } : phase,
    );
    updateState({ paymentSchedule: schedule });
  }

  function updateDeposit(value: number) {
    const depositPercent = Math.max(0, Math.min(100, value || 0));
    const isDefaultSchedule =
      state.paymentSchedule.length === 2
      && state.paymentSchedule[0]?.concept === "Anticipo"
      && state.paymentSchedule[1]?.concept === "Resto";
    updateState({
      depositPercent,
      ...(isDefaultSchedule ? { paymentSchedule: defaultPaymentSchedule(depositPercent) } : {}),
    });
  }

  const paymentPhasesTotal = state.paymentSchedule.reduce(
    (sum, phase) => sum + (Number(phase.percent) || 0),
    0,
  );

  return (
    <>
      <Card>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-green">
          Condiciones del presupuesto
        </h2>
        <p className="mb-5 text-sm text-navy-500 dark:text-zinc-400">
          Estos datos se guardan en el presupuesto y aparecen en el PDF del cliente y en la copia interna.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Validez del presupuesto</label>
            <input
              type="date"
              value={state.validUntil}
              onChange={(event) => updateState({ validUntil: event.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Anticipo (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={state.depositPercent}
              onChange={(event) => updateDeposit(Number(event.target.value))}
              className={inputCls}
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Descuento</label>
            <div className="flex gap-2">
              <select
                value={state.discountType}
                onChange={(event) => updateState({
                  discountType: event.target.value === "amount" ? "amount" : "percent",
                })}
                className={`${inputCls} max-w-[90px]`}
              >
                <option value="percent">%</option>
                <option value="amount">€</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={state.discountType === "percent" ? state.discountPercent : state.discountAmount}
                onChange={(event) => {
                  const value = Math.max(0, Number(event.target.value) || 0);
                  updateState(state.discountType === "percent"
                    ? { discountPercent: Math.min(100, value) }
                    : { discountAmount: value });
                }}
                className={inputCls}
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Forma de pago</label>
            <div className="mb-2 flex flex-wrap gap-2">
              {paymentMethodQuickOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => updateState({ paymentMethod: option })}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    state.paymentMethod === option
                      ? "border-brand-green bg-brand-green text-navy-900"
                      : "border-navy-200 bg-white text-navy-600 hover:border-brand-green dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={state.paymentMethod}
              onChange={(event) => updateState({ paymentMethod: event.target.value })}
              placeholder="Ej: 50% al aceptar, 50% a la finalización"
              className={inputCls}
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>IBAN</label>
            <input
              type="text"
              value={state.paymentIban}
              onChange={(event) => updateState({ paymentIban: event.target.value })}
              placeholder="ES00 0000 0000 0000 0000 0000"
              className={inputCls}
            />
            {fiscalIban && state.paymentIban.trim() !== fiscalIban.trim() && (
              <p className="mt-1 text-xs text-navy-400 dark:text-zinc-500">
                IBAN configurado para la empresa: {fiscalIban}.{" "}
                <button
                  type="button"
                  onClick={() => updateState({ paymentIban: fiscalIban })}
                  className="text-brand-green hover:underline"
                >
                  Usar este
                </button>
              </p>
            )}
          </div>

          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <label className={labelCls}>Fases de pago</label>
              <button
                type="button"
                onClick={() => updateState({
                  paymentSchedule: [
                    ...state.paymentSchedule,
                    { percent: 0, concept: "", moment: "" },
                  ],
                })}
                className="text-xs font-medium text-brand-green hover:underline"
              >
                + Añadir fase
              </button>
            </div>
            <div className="space-y-2">
              {state.paymentSchedule.map((phase, index) => (
                <div key={`${index}-${phase.concept}`} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[80px_1fr_1fr_auto]">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={phase.percent}
                    onChange={(event) => updatePaymentPhase(index, "percent", Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                    placeholder="%"
                    className={inputSmCls}
                  />
                  <input
                    type="text"
                    value={phase.concept}
                    onChange={(event) => updatePaymentPhase(index, "concept", event.target.value)}
                    placeholder="Concepto (ej: Anticipo)"
                    className={inputSmCls}
                  />
                  <input
                    type="text"
                    value={phase.moment}
                    onChange={(event) => updatePaymentPhase(index, "moment", event.target.value)}
                    placeholder="Momento (ej: al aceptar)"
                    className={inputSmCls}
                  />
                  {state.paymentSchedule.length > 1 && (
                    <button
                      type="button"
                      onClick={() => updateState({
                        paymentSchedule: state.paymentSchedule.filter((_, phaseIndex) => phaseIndex !== index),
                      })}
                      className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                      aria-label={`Eliminar fase ${index + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {state.paymentSchedule.length > 0 && paymentPhasesTotal !== 100 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Las fases suman {paymentPhasesTotal}%.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Plazo de ejecución</label>
            <textarea
              value={state.executionDeadlineText}
              onChange={(event) => updateState({ executionDeadlineText: event.target.value })}
              rows={2}
              placeholder="Ej: 15 días laborables desde el inicio de la obra"
              className={`${inputCls} resize-none`}
            />
          </div>
          <div>
            <label className={labelCls}>Garantía</label>
            <textarea
              value={state.warrantyText}
              onChange={(event) => updateState({ warrantyText: event.target.value })}
              rows={2}
              placeholder="Ej: 2 años de garantía en mano de obra y materiales"
              className={`${inputCls} resize-none`}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Condiciones</label>
            <textarea
              value={state.conditionsText}
              onChange={(event) => updateState({ conditionsText: event.target.value })}
              rows={3}
              placeholder="Condiciones legales y comerciales del presupuesto..."
              className={`${inputCls} resize-none`}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Observaciones</label>
            <textarea
              value={state.observations}
              onChange={(event) => updateState({ observations: event.target.value })}
              rows={2}
              placeholder="Observaciones adicionales para el cliente..."
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-green">
          Notas internas
        </h2>
        <textarea
          value={state.internalNotes}
          onChange={(event) => updateState({ internalNotes: event.target.value })}
          rows={3}
          placeholder="Riesgos, acuerdos, accesos, comprobaciones o recordatorios para el equipo..."
          className={`${inputCls} resize-none`}
        />
        <p className="mt-1 text-xs text-navy-400 dark:text-zinc-500">
          Son privadas: nunca aparecerán en el PDF del cliente.
        </p>
      </Card>
    </>
  );
}
