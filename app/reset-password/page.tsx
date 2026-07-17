"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import PasswordStrength from "@/components/PasswordStrength";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  // Supabase exchanges the token from the URL hash automatically
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "PASSWORD_RECOVERY") {
          setSessionReady(true);
        }
      }
    );

    // Also check if we already have a session (user clicked link and session was set)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      }
    });

    return () => subscription.unsubscribe();
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
      <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6 dark:bg-zinc-950">
        <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 text-center shadow-lg dark:bg-zinc-900 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto rounded-full bg-brand-green/10 flex items-center justify-center text-3xl mb-6">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-navy-900 dark:text-white">
            Contraseña actualizada
          </h2>
          <p className="mt-3 text-navy-600 dark:text-zinc-400">
            Tu contraseña ha sido restablecida correctamente. Redirigiendo al dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6 dark:bg-zinc-950">
        <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 text-center shadow-lg dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex justify-center mb-6">
            <Logo href="/" size={36} />
          </div>
          <div className="w-12 h-12 mx-auto rounded-full border-4 border-navy-200 border-t-brand-green animate-spin dark:border-zinc-700 dark:border-t-brand-green" />
          <p className="mt-4 text-navy-600 dark:text-zinc-400">
            Verificando enlace de recuperación...
          </p>
          <p className="mt-4 text-sm text-navy-500 dark:text-zinc-500">
            Si no se carga en unos segundos, el enlace puede haber expirado.{" "}
            <Link href="/forgot-password" className="text-brand-green font-semibold hover:underline">
              Solicitar uno nuevo
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6 dark:bg-zinc-950">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 shadow-lg dark:bg-zinc-900 dark:border-zinc-800">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <Logo href="/" size={36} />
          </div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
            Nueva contraseña
          </h1>
          <p className="mt-2 text-navy-600 dark:text-zinc-400">
            Introduce tu nueva contraseña
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1 dark:text-zinc-300">
              Nueva contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              placeholder="Mínimo 8 caracteres"
              aria-describedby="password-strength"
            />
            <div id="password-strength">
              <PasswordStrength password={password} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1 dark:text-zinc-300">
              Confirmar contraseña
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              placeholder="Repite tu contraseña"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Guardando..." : "Restablecer contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
