"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell, { authLabel, authInput, authButton } from "@/components/AuthShell";
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
    <AuthShell panel="brand">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] text-[#101d33]">Hola de nuevo</h1>
        <p className="text-sm text-[#5b6b80]">Inicia sesión en tu cuenta.</p>
      </div>
      <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
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
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[13px] font-semibold text-[#22334e]">Contraseña</label>
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-[#0e9f76] hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={authInput}
            placeholder="Tu contraseña"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? "Iniciando sesión..." : <>Iniciar sesión <span className="font-normal">→</span></>}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-[#5b6b80]">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="font-semibold text-[#0e9f76] hover:underline">
          Crea una
        </Link>
      </p>
    </AuthShell>
  );
}
