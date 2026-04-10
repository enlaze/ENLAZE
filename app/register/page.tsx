"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import Logo from "@/components/Logo";

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
      setSuccess(true);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 text-center shadow-lg">
          <div className="w-16 h-16 mx-auto rounded-full bg-brand-green/10 flex items-center justify-center text-3xl mb-6">✓</div>
          <h2 className="text-2xl font-bold text-navy-900">Revisa tu email</h2>
          <p className="mt-3 text-navy-600">Te hemos enviado un enlace de confirmacion a <strong>{email}</strong></p>
          <Link href="/login" className="mt-6 inline-block text-brand-green font-semibold hover:underline">Ir al login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 shadow-lg">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <Logo href="/" size={36} />
          </div>
          <h1 className="text-2xl font-bold text-navy-900">Crea tu cuenta</h1>
          <p className="mt-2 text-navy-600">Empieza a automatizar tu comunicacion</p>
        </div>
        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Nombre completo</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green" placeholder="Tu nombre" />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green" placeholder="tu@empresa.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Contrasena</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green" placeholder="Minimo 6 caracteres" />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50">
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-navy-600">
          Ya tienes cuenta? <Link href="/login" className="text-brand-green font-semibold hover:underline">Inicia sesion</Link>
        </p>
      </div>
    </div>
  );
}
