"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { analytics, identifyUser } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Identify user in analytics + error tracking
      identifyUser(data.user.id, { email: data.user.email, name: data.user.user_metadata?.full_name });
      setSentryUser({ id: data.user.id, email: data.user.email ?? undefined, name: data.user.user_metadata?.full_name });
      analytics.userLoggedIn("email");

      // Comprobar si hizo onboarding
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", data.user.id)
        .single();
      if (profile && profile.onboarding_completed) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6 dark:bg-zinc-950">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 shadow-lg dark:bg-zinc-900 dark:border-zinc-800">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <Logo href="/" size={36} />
          </div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Bienvenido de nuevo</h1>
          <p className="mt-2 text-navy-600 dark:text-zinc-400">Inicia sesión en tu cuenta</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1 dark:text-zinc-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              placeholder="tu@empresa.com"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-navy-700 dark:text-zinc-300">Contraseña</label>
              <Link
                href="/forgot-password"
                className="text-xs text-brand-green font-medium hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              placeholder="Tu contraseña"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-navy-600 dark:text-zinc-400">
          ¿No tienes cuenta?{" "}
          <Link href="/register" className="text-brand-green font-semibold hover:underline">
            Regístrate
          </Link>
        </p>
      </div>
    </div>
  );
}
