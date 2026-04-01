"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
      // Comprobar si hizo onboarding
        const { data: profile } = await supabase.from("profiles").select("onboarding_completed").eq("id", data.user.id).single();
        if (profile && profile.onboarding_completed) {
          router.push("/dashboard");
        } else {
          router.push("/onboarding");
        }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 shadow-lg">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-9 h-9 rounded-xl bg-navy-800 flex items-center justify-center">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <span className="text-xl font-bold text-navy-900">Enlaze</span>
          </Link>
          <h1 className="text-2xl font-bold text-navy-900">Bienvenido de nuevo</h1>
          <p className="mt-2 text-navy-600">Inicia sesion en tu cuenta</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green" placeholder="tu@empresa.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Contrasena</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green" placeholder="Tu contrasena" />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50">
            {loading ? "Iniciando sesion..." : "Iniciar sesion"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-navy-600">
          No tienes cuenta? <Link href="/register" className="text-brand-green font-semibold hover:underline">Registrate</Link>
        </p>
      </div>
    </div>
  );
}
