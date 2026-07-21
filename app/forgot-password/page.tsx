"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import AuthShell, { authLabel, authInput, authButton } from "@/components/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    // Mostramos SIEMPRE el mismo mensaje neutro, exista o no la cuenta, para no
    // revelar qué correos están registrados. El error solo se registra para
    // diagnóstico interno.
    if (error) {
      console.error("[forgot-password] resetPasswordForEmail error:", error.message);
    }

    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <AuthShell panel="recover">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <svg
              className="h-8 w-8 text-brand-green"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </div>
          <h2 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Revisa tu email</h2>
          <p className="mt-3 text-sm text-[#5b6b80]">
            Si existe una cuenta con <strong className="text-[#22334e]">{email}</strong>, te hemos enviado un enlace para restablecer tu contraseña.
          </p>
          <div className="mt-6 rounded-[10px] border border-[#dbe3ee] bg-[#fbfcfe] p-4 text-left">
            <p className="text-xs text-[#5b6b80]">
              <strong className="text-[#22334e]">Nota:</strong> El enlace es válido por 1 hora. Si no lo ves en tu bandeja, revisa la carpeta de spam.
            </p>
          </div>
          <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-[#0e9f76] hover:underline">
            ← Volver a iniciar sesión
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell panel="recover">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Recupera tu acceso</h1>
        <p className="text-sm text-[#5b6b80]">
          Te enviaremos un enlace para restablecer tu contraseña.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label className={authLabel}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={authInput}
            placeholder="tu@empresa.com"
          />
        </div>
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? "Enviando..." : <>Enviar enlace <span className="font-normal">→</span></>}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px]">
        <Link href="/login" className="font-semibold text-[#0e9f76] hover:underline">
          ← Volver a iniciar sesión
        </Link>
      </p>
    </AuthShell>
  );
}
