"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import AuthShell, { authLabel, authInput, authButton } from "@/components/AuthShell";
import PasswordStrength from "@/components/PasswordStrength";
import { analytics } from "@/lib/analytics";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Send verification email
      try {
        const response = await fetch("/api/auth/send-verification-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const data = await response.json();

        if (data.success) {
          analytics.userRegistered(email);
          setSuccess(true);
        } else {
          setError(
            data.message || "Cuenta creada pero no pudimos enviar el email de verificación. Intenta manualmente."
          );
        }
      } catch (err) {
        console.error("Failed to send verification email:", err);
        setError(
          "Cuenta creada pero hubo un error al enviar el email de verificación. Intenta manualmente."
        );
      }
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthShell panel="brand">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 text-3xl text-brand-green">
            ✓
          </div>
          <h2 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Revisa tu email</h2>
          <p className="mt-3 text-sm text-[#5b6b80]">
            Te hemos enviado un enlace de confirmación a <strong className="text-[#22334e]">{email}</strong>
          </p>
          <p className="mt-4 text-sm text-[#95a3b8]">
            Haz clic en el enlace para verificar tu cuenta y completar el registro.
          </p>
          <div className="mt-6 rounded-[10px] border border-[#dbe3ee] bg-[#fbfcfe] p-4 text-left">
            <p className="text-xs text-[#5b6b80]">
              <strong className="text-[#22334e]">Nota:</strong> El enlace es válido por 24 horas. Si no lo ves en tu bandeja, revisa la carpeta de spam.
            </p>
          </div>
          <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-[#0e9f76] hover:underline">
            Ir al login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell panel="brand">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Crea tu cuenta</h1>
        <p className="text-sm text-[#5b6b80]">Empieza gratis en menos de un minuto.</p>
      </div>
      <form onSubmit={handleRegister} className="mt-6 flex flex-col gap-4">
        <div>
          <label className={authLabel}>Nombre completo</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className={authInput}
            placeholder="Tu nombre"
          />
        </div>
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
        <div>
          <label className={authLabel}>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={authInput}
            placeholder="Mínimo 8 caracteres"
            aria-describedby="password-strength"
          />
          <div id="password-strength">
            <PasswordStrength password={password} />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? "Creando cuenta..." : <>Crear cuenta <span className="font-normal">→</span></>}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-[#5b6b80]">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-semibold text-[#0e9f76] hover:underline">
          Inicia sesión
        </Link>
      </p>
    </AuthShell>
  );
}
