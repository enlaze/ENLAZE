"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell, { authLabel, authInput, authButton } from "@/components/AuthShell";
import PasswordStrength from "@/components/PasswordStrength";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const supabase = createClient();
  const router = useRouter();

  // Al aterrizar desde el email, Supabase deja una sesión de recuperación.
  // Detectamos esa sesión (evento PASSWORD_RECOVERY o sesión ya presente); si el
  // enlace trae un error o no aparece ninguna sesión, lo tratamos como inválido.
  useEffect(() => {
    // Si el enlace caducó o es inválido, Supabase adjunta el error en el hash
    // (#error=...) o en el query (?error=...) al redirigir aquí.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    if (hashParams.get("error") || queryParams.get("error")) {
      setStatus("invalid");
      return;
    }

    let resolved = false;
    const markReady = () => {
      resolved = true;
      setStatus("ready");
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
          markReady();
        }
      }
    );

    // La sesión puede haberse establecido antes de que nos suscribamos.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady();
    });

    // Red de seguridad: si no aparece ninguna sesión de recuperación, el enlace
    // es inválido o ha caducado.
    const timer = setTimeout(() => {
      if (!resolved) setStatus("invalid");
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    }
  };

  if (success) {
    return (
      <AuthShell panel="recover">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 text-3xl text-brand-green">
            ✓
          </div>
          <h2 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Contraseña actualizada</h2>
          <p className="mt-3 text-sm text-[#5b6b80]">
            Tu contraseña ha sido restablecida correctamente. Redirigiendo al dashboard...
          </p>
        </div>
      </AuthShell>
    );
  }

  if (status === "invalid") {
    return (
      <AuthShell panel="recover">
        <div className="text-center">
          <h2 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Enlace no válido</h2>
          <p className="mt-3 text-sm text-[#5b6b80]">
            Este enlace de recuperación no es válido o ha caducado. Los enlaces solo pueden usarse una vez y expiran al cabo de una hora.
          </p>
          <Link href="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-[#0e9f76] hover:underline">
            Solicitar un enlace nuevo
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (status === "checking") {
    return (
      <AuthShell panel="recover">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#e5eaf1] border-t-brand-green" />
          <p className="mt-4 text-sm text-[#5b6b80]">
            Verificando enlace de recuperación...
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell panel="recover">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Nueva contraseña</h1>
        <p className="text-sm text-[#5b6b80]">Elige una contraseña nueva para tu cuenta.</p>
      </div>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label className={authLabel}>Nueva contraseña</label>
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
        <div>
          <label className={authLabel}>Confirmar contraseña</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className={authInput}
            placeholder="Repite tu contraseña"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? "Guardando..." : <>Restablecer contraseña <span className="font-normal">→</span></>}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-[#95a3b8]">
        Al guardarla, cerraremos las sesiones abiertas en otros dispositivos.
      </p>
    </AuthShell>
  );
}
