"use client";

import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-fields";
import { useToast } from "@/components/ui/toast";

type Step = "info" | "draw" | "otp" | "done";

interface SignatureFlowProps {
  userId: string;
  entityType: "budget" | "certification" | "work_report" | "project_act";
  entityId: string;
  signerName?: string;
  signerEmail?: string;
  documentTitle?: string;
  onComplete?: (signatureId: string) => void;
  onCancel?: () => void;
}

export default function SignatureFlow({
  userId,
  entityType,
  entityId,
  signerName: initialName = "",
  signerEmail: initialEmail = "",
  documentTitle = "Documento",
  onComplete,
  onCancel,
}: SignatureFlowProps) {
  const toast = useToast();

  const [step, setStep] = useState<Step>("info");
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Info form
  const [signerName, setSignerName] = useState(initialName);
  const [signerEmail, setSignerEmail] = useState(initialEmail);
  const [signerNif, setSignerNif] = useState("");
  const [signerRole, setSignerRole] = useState("cliente");

  // OTP
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpExpiry, setOtpExpiry] = useState<string | null>(null);

  // Signature
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  const entityLabels: Record<string, string> = {
    budget: "Presupuesto",
    certification: "Certificación",
    work_report: "Parte de trabajo",
    project_act: "Acta de obra",
  };

  /* ── Step 1: Create signature record ── */
  async function handleInfoSubmit() {
    if (!signerName.trim()) {
      toast.error("El nombre del firmante es obligatorio.");
      return;
    }
    if (!signerEmail.trim()) {
      toast.error("El email es necesario para la verificación OTP.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/signatures/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          entity_type: entityType,
          entity_id: entityId,
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim(),
          signer_nif: signerNif,
          signer_role: signerRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSignatureId(data.id);
      setStep("draw");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear firma");
    }
    setLoading(false);
  }

  /* ── Step 2: Save drawn signature ── */
  async function handleSignatureSave(dataUrl: string) {
    if (!signatureId) return;
    setSignatureImage(dataUrl);
    setLoading(true);

    try {
      const res = await fetch("/api/signatures/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          signature_image: dataUrl,
          user_agent: navigator.userAgent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("otp");
      // Auto-send OTP
      await sendOtp();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar firma");
    }
    setLoading(false);
  }

  /* ── Step 3: Send OTP ── */
  async function sendOtp() {
    if (!signatureId) return;
    try {
      const res = await fetch("/api/signatures/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          email: signerEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setOtpSent(true);
      setOtpExpiry(data.expires_at);
      toast.success(`Código enviado a ${signerEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar código");
    }
  }

  /* ── Step 3: Verify OTP ── */
  async function handleVerifyOtp() {
    if (!signatureId || !otpCode.trim()) {
      toast.error("Introduce el código de 6 dígitos.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/signatures/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          code: otpCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("done");
      toast.success("Firma verificada correctamente");
      onComplete?.(signatureId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Código incorrecto");
    }
    setLoading(false);
  }

  /* ── Render ── */

  return (
    <div className="max-w-lg mx-auto">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-6">
        {(["info", "draw", "otp", "done"] as Step[]).map((s, i) => {
          const labels = ["Datos", "Firma", "Verificar", "Completado"];
          const isActive = s === step;
          const isDone = ["info", "draw", "otp", "done"].indexOf(step) > i;
          return (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${
                isDone || isActive ? "bg-brand-green" : "bg-navy-100 dark:bg-zinc-800"
              }`} />
              <p className={`text-[10px] mt-1 ${
                isActive ? "text-brand-green font-semibold" : "text-navy-400 dark:text-zinc-500"
              }`}>
                {labels[i]}
              </p>
            </div>
          );
        })}
      </div>

      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-navy-900 dark:text-white">
          Firma digital
        </h3>
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          {entityLabels[entityType]}: {documentTitle}
        </p>
      </div>

      {/* ── Step: Info ── */}
      {step === "info" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nombre del firmante" required>
              <Input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Nombre completo"
              />
            </FormField>
            <FormField label="Email" required>
              <Input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="Para enviar código de verificación"
              />
            </FormField>
            <FormField label="NIF / DNI">
              <Input
                type="text"
                value={signerNif}
                onChange={(e) => setSignerNif(e.target.value)}
                placeholder="12345678A"
              />
            </FormField>
            <FormField label="Rol">
              <select
                value={signerRole}
                onChange={(e) => setSignerRole(e.target.value)}
                className="w-full rounded-xl border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm"
              >
                <option value="cliente">Cliente / Propiedad</option>
                <option value="encargado">Encargado</option>
                <option value="director_obra">Director de obra</option>
                <option value="propiedad">Promotor</option>
              </select>
            </FormField>
          </div>

          <div className="flex gap-3 pt-4 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleInfoSubmit} disabled={loading}>
              {loading ? "Creando..." : "Siguiente"}
            </Button>
            {onCancel && (
              <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            )}
          </div>
        </div>
      )}

      {/* ── Step: Draw ── */}
      {step === "draw" && (
        <div className="space-y-4">
          <p className="text-sm text-navy-600 dark:text-zinc-400">
            Dibuja tu firma en el recuadro. Puedes usar el dedo en móvil o el ratón en PC.
          </p>
          <SignaturePad
            onSave={handleSignatureSave}
            label={`Firma de ${signerName}`}
            width={460}
            height={180}
          />
          {loading && (
            <p className="text-sm text-navy-500 animate-pulse">Guardando firma...</p>
          )}
        </div>
      )}

      {/* ── Step: OTP ── */}
      {step === "otp" && (
        <div className="space-y-4">
          {/* Show signature preview */}
          {signatureImage && (
            <div className="rounded-xl border border-navy-100 dark:border-zinc-800 p-3 bg-white">
              <img src={signatureImage} alt="Firma" className="h-20 mx-auto" />
            </div>
          )}

          <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Hemos enviado un código de 6 dígitos a <strong>{signerEmail}</strong>.
              Introdúcelo para completar la firma.
            </p>
          </div>

          <FormField label="Código de verificación" required>
            <Input
              type="text"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              className="text-center text-2xl tracking-[0.5em] font-mono"
            />
          </FormField>

          <div className="flex gap-3">
            <Button onClick={handleVerifyOtp} disabled={loading || otpCode.length !== 6}>
              {loading ? "Verificando..." : "Verificar y firmar"}
            </Button>
            <Button variant="secondary" onClick={sendOtp}>
              Reenviar código
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === "done" && (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-navy-900 dark:text-white mb-2">
            Firma completada
          </h3>
          <p className="text-sm text-navy-500 dark:text-zinc-400 mb-1">
            {signerName} ha firmado el {entityLabels[entityType].toLowerCase()}
          </p>
          <p className="text-xs text-navy-400 dark:text-zinc-500">
            Verificado por email · {new Date().toLocaleDateString("es-ES")} {new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </p>

          {signatureImage && (
            <div className="mt-4 rounded-xl border border-navy-100 dark:border-zinc-800 p-3 bg-white inline-block">
              <img src={signatureImage} alt="Firma" className="h-16" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
