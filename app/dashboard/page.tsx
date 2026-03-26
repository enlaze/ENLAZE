"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setUser(user);
      setLoading(false);
    };
    getUser();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50">
        <div className="text-navy-600">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      <header className="bg-white border-b border-navy-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-navy-800 flex items-center justify-center">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <span className="text-xl font-bold text-navy-900">Enlaze</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-navy-600">{user?.email}</span>
            <button onClick={handleLogout} className="px-4 py-2 rounded-xl border border-navy-200 text-sm font-medium text-navy-700 hover:bg-navy-50 transition-colors">
              Cerrar sesion
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-navy-900">Bienvenido, {user?.user_metadata?.full_name || "Usuario"}</h1>
        <p className="mt-2 text-navy-600">Este es tu panel de control de Enlaze.</p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-navy-500">Mensajes WhatsApp</p>
            <p className="mt-2 text-3xl font-bold text-navy-900">0</p>
            <p className="mt-1 text-xs text-navy-400">enviados hoy</p>
          </div>
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-navy-500">Emails enviados</p>
            <p className="mt-2 text-3xl font-bold text-navy-900">0</p>
            <p className="mt-1 text-xs text-navy-400">automatizados</p>
          </div>
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-navy-500">Citas agendadas</p>
            <p className="mt-2 text-3xl font-bold text-navy-900">0</p>
            <p className="mt-1 text-xs text-navy-400">esta semana</p>
          </div>
        </div>
      </main>
    </div>
  );
}
