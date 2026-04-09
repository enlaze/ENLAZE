"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import Link from "next/link";

export default function SettingsPage() {
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState({ type: "", text: "" });
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState({ type: "", text: "" });
  const supabase = createClient();

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "");
        setFullName(user.user_metadata?.full_name || "");
        const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        if (data) { setFullName(data.full_name || ""); setCompanyName(data.company_name || ""); }
      }
    };
    load();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setResult({ type: "", text: "" });
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({ id: user.id, email: user.email, full_name: fullName, company_name: companyName, updated_at: new Date().toISOString() });
      await supabase.auth.updateUser({ data: { full_name: fullName } });
      setResult({ type: "success", text: "Perfil actualizado correctamente" });
    }
    setSaving(false);
    setTimeout(() => setResult({ type: "", text: "" }), 4000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordResult({ type: "", text: "" });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setPasswordResult({ type: "error", text: error.message }); } else { setPasswordResult({ type: "success", text: "Contrasena actualizada correctamente" }); setNewPassword(""); }
    setSavingPassword(false);
    setTimeout(() => setPasswordResult({ type: "", text: "" }), 4000);
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900">Ajustes</h1>
        <p className="mt-1 text-navy-600">Configura tu perfil y cuenta</p>
      </div>
      <div className="max-w-2xl space-y-6">
        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/dashboard/settings/sector" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <h3 className="font-semibold text-navy-900 group-hover:text-brand-green transition-colors">Sector de actividad</h3>
                <p className="text-xs text-navy-500">Adapta Enlaze a tu sector</p>
              </div>
            </div>
          </Link>
          <Link href="/dashboard/settings/fiscal" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧾</span>
              <div>
                <h3 className="font-semibold text-navy-900 group-hover:text-brand-green transition-colors">Ajustes fiscales</h3>
                <p className="text-xs text-navy-500">NIF, IVA, series, Verifactu</p>
              </div>
            </div>
          </Link>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-navy-900 mb-4">Perfil</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Email</label><input type="email" value={email} disabled className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-100 text-navy-500 cursor-not-allowed" /></div>
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Nombre completo</label><input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Tu nombre" /></div>
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Nombre de la empresa</label><input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Tu empresa" /></div>
            {result.text && <p className={`text-sm ${result.type === "success" ? "text-brand-green" : "text-red-500"}`}>{result.text}</p>}
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold hover:bg-brand-green-dark transition-colors disabled:opacity-50">{saving ? "Guardando..." : "Guardar cambios"}</button>
          </form>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-navy-900 mb-4">Cambiar contrasena</h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Nueva contrasena</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Minimo 6 caracteres" /></div>
            {passwordResult.text && <p className={`text-sm ${passwordResult.type === "success" ? "text-brand-green" : "text-red-500"}`}>{passwordResult.text}</p>}
            <button type="submit" disabled={savingPassword} className="px-5 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-semibold hover:bg-navy-900 transition-colors disabled:opacity-50">{savingPassword ? "Actualizando..." : "Cambiar contrasena"}</button>
          </form>
        </div>
        <div className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-red-600 mb-2">Zona peligrosa</h2>
          <p className="text-sm text-navy-600 mb-4">Estas acciones son irreversibles. Procede con cuidado.</p>
          <button className="px-5 py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">Eliminar cuenta</button>
        </div>
      </div>
    </>
  );
}
