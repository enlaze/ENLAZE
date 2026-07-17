"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const siteUrl = window.location.origin;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6 dark:bg-zinc-950">
        <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 text-center shadow-lg dark:bg-zinc-900 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto rounded-full bg-brand-green/10 flex items-center justify-center text-3xl mb-6">
            ✉️
          </div>
          <h2 className="text-2xl font-bold text-navy-900 dark:text-white">
            Revisa tu email
          </h2>
          <p className="mt-3 text-navy-600 dark:text-zinc-400">
            Si existe una cuenta con <strong className="dark:text-zinc-200">{email}</strong>, te hemos enviado un enlace para restablecer tu contraseña.
          </p>
          <div className="mt-6 p-4 rounded-lg bg-navy-50 border border-navy-100 dark:bg-zinc-800 dark:border-zinc-700">
            <p className="text-xs text-navy-600 dark:text-zinc-400">
              <strong className="dark:text-zinc-300">Nota:</strong> El enlace es válido por 1 hora. Si no lo ves en tu bandeja, revisa la carpeta de spam.
            </p>
          </div>
          <Link
            href="/login"
            className="mt-6 inline-block text-brand-green font-semibold hover:underline"
          >
            Volver al login
          </Link>
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
            ¿Olvidaste tu contraseña?
          </h1>
          <p className="mt-2 text-navy-600 dark:text-zinc-400">
            Introduce tu email y te enviaremos un enlace para restablecerla.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1 dark:text-zinc-300">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              placeholder="tu@empresa.com"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Enviar enlace de recuperación"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-navy-600 dark:text-zinc-400">
          <Link
            href="/login"
            className="text-brand-green font-semibold hover:underline"
          >
            Volver al login
          </Link>
        </p>
      </div>
    </div>
  );
}
