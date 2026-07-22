"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SignaturePad from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-fields";

interface SignatureInfo {
  id: string;
  entity_type: string;
  signer_name: string;
  signer_email: string;
  signer_role: string;
  status: string;
  signed_at: string | null;
  signature_image: string;
  document: {
    title: string;
    detail: string;
  };
}

const roleLabels: Record<string, string> = {
  cliente: "Cliente",
  encargado: "Encargado",
  director_obra: "Director de obra",
  propiedad: "Promotor",
};

export default function PublicSignPage() {
  const params = useParams();
  const signatureId = params.id as string;

  const [info, setInfo] = useState<SignatureInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Steps
  const [step, setStep] = useState<"draw" | "otp" | "done">("draw");
  const [otpCode, setOtpCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/signatures/public?id=${signatureId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setInfo(data);

        if (data.status === "signed") {
          setStep("done");
          setSignatureImage(data.signature_image);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar");
      }
      setLoading(false);
    }
    load();
  }, [signatureId]);

  async function handleSaveSignature(dataUrl: string) {
    setSignatureImage(dataUrl);
    setSending(true);

    try {
      // Save the drawn signature
      const saveRes = await fetch("/api/signatures/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          signature_image: dataUrl,
          user_agent: navigator.userAgent,
        }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json();
        throw new Error(d.error);
      }

      // Send OTP
      const otpRes = await fetch("/api/signatures/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          email: info?.signer_email,
        }),
      });
      if (!otpRes.ok) {
        const d = await otpRes.json();
        throw new Error(d.error);
      }

      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
    setSending(false);
  }

  async function handleVerify() {
    if (otpCode.length !== 6) return;
    setVerifying(true);

    try {
      const res = await fetch("/api/signatures/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_id: signatureId, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código incorrecto");
    }
    setVerifying(false);
  }

  async function resendOtp() {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/signatures/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature_id: signatureId,
          email: info?.signer_email,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al reenviar");
    }
    setSending(false);
  }

  /* ── Render ── */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-navy-50">
        <div className="text-navy-500 animate-pulse">Cargando...</div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-navy-50">
        <div className="max-w-sm text-center">
          <p className="text-red-600 font-semibold mb-2">Firma no encontrada</p>
          <p className="text-sm text-navy-500">{error || "Este enlace de firma no es válido o ha expirado."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-[#f4f7fa]">
      {/* Header */}
      <div className="border-b border-navy-100 bg-white/90 backdrop-blur">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="bg-[#0f2744] rounded-lg px-3 py-1.5">
            <span className="text-[#00c896] font-bold text-lg">Enlaze</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-navy-900">Firma digital</p>
            <p className="text-xs text-navy-500">{info.document.title}</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Document info */}
        <div className="rounded-2xl border border-navy-100 bg-white p-6 mb-6 shadow-sm">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-navy-500 uppercase tracking-wider font-semibold mb-1">Documento</p>
              <p className="font-medium text-navy-900">{info.document.title}</p>
              {info.document.detail && (
                <p className="text-navy-500 text-xs mt-0.5">{info.document.detail}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-navy-500 uppercase tracking-wider font-semibold mb-1">Firmante</p>
              <p className="font-medium text-navy-900">{info.signer_name}</p>
              <p className="text-navy-500 text-xs mt-0.5">{roleLabels[info.signer_role] || info.signer_role}</p>
            </div>
          </div>
        </div>

        {error && step !== "done" && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ── Draw ── */}
        {step === "draw" && (
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-navy-900 mb-1">Firme aquí</h2>
            <p className="text-sm text-navy-500 mb-4">
              Dibuje su firma en el recuadro inferior. Después verificaremos con un código enviado a su email.
            </p>
            <SignaturePad
              onSave={handleSaveSignature}
              label={`Firma de ${info.signer_name}`}
              width={460}
              height={180}
              disabled={sending}
            />
            {sending && (
              <p className="text-sm text-navy-500 mt-3 animate-pulse">Procesando firma...</p>
            )}
          </div>
        )}

        {/* ── OTP ── */}
        {step === "otp" && (
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm space-y-4">
            {signatureImage && (
              <div className="rounded-xl border border-navy-100 p-3 bg-navy-50/50">
                <img src={signatureImage} alt="Su firma" className="h-16 mx-auto" />
              </div>
            )}

            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
              <p className="text-sm text-blue-800">
                Hemos enviado un código de 6 dígitos a <strong>{info.signer_email}</strong>.
              </p>
            </div>

            <FormField label="Código de verificación" required>
              <Input
                type="text"
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl tracking-[0.5em] font-mono"
              />
            </FormField>

            <div className="flex gap-3">
              <Button onClick={handleVerify} disabled={verifying || otpCode.length !== 6}>
                {verifying ? "Verificando..." : "Verificar y firmar"}
              </Button>
              <Button variant="secondary" onClick={resendOtp} disabled={sending}>
                {sending ? "Enviando..." : "Reenviar código"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Done ── */}
        {step === "done" && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-8 shadow-sm text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-green-900 mb-2">
              Documento firmado correctamente
            </h2>
            <p className="text-sm text-green-700 mb-1">
              {info.signer_name} — {roleLabels[info.signer_role] || info.signer_role}
            </p>
            <p className="text-xs text-green-600">
              {info.document.title} · Verificado por email ·{" "}
              {info.signed_at
                ? new Date(info.signed_at).toLocaleString("es-ES")
                : new Date().toLocaleString("es-ES")}
            </p>

            {signatureImage && (
              <div className="mt-4 rounded-xl border border-green-200 bg-white p-3 inline-block">
                <img src={signatureImage} alt="Firma" className="h-16" />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-navy-400 mt-8">
          Firma electrónica verificada por Enlaze · Cumple con eIDAS Art. 25
        </p>
      </div>
    </div>
  );
}
