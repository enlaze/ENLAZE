"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "@/lib/theme-context";
import Link from "next/link";

type ThemePreference = "light" | "dark" | "system";

export default function SettingsPage() {
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState({ type: "", text: "" });
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState({ type: "", text: "" });
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [savingTheme, setSavingTheme] = useState(false);
  const { theme, setTheme } = useTheme();
  const supabase = createClient();

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "");
        setFullName(user.user_metadata?.full_name || "");
        const savedTheme = user.user_metadata?.theme_preference as ThemePreference || "system";
        setThemePreference(savedTheme);
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

  const handleThemeChange = async (newTheme: ThemePreference) => {
    setSavingTheme(true);
    setThemePreference(newTheme);
    try {
      await setTheme(newTheme);
      setResult({ type: "success", text: "Preferencia de tema actualizada" });
    } catch (error) {
      console.error("Error saving theme preference:", error);
      setResult({ type: "error", text: "Error al guardar la preferencia de tema" });
    }
    setSavingTheme(false);
    setTimeout(() => setResult({ type: "", text: "" }), 4000);
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white">Ajustes</h1>
        <p className="mt-1 text-navy-600 dark:text-zinc-400">Configura tu perfil y cuenta</p>
      </div>
      <div className="max-w-2xl space-y-6">
        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/dashboard/settings/sector" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <h3 className="font-semibold text-navy-900 dark:text-white group-hover:text-brand-green transition-colors">Sector de actividad</h3>
                <p className="text-xs text-navy-500 dark:text-zinc-400">Adapta Enlaze a tu sector</p>
              </div>
            </div>
          </Link>
          <Link href="/dashboard/settings/fiscal" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧾</span>
              <div>
                <h3 className="font-semibold text-navy-900 dark:text-white group-hover:text-brand-green transition-colors">Ajustes fiscales</h3>
                <p className="text-xs text-navy-500 dark:text-zinc-400">NIF, IVA, series, Verifactu</p>
              </div>
            </div>
          </Link>
          <Link href="/dashboard/settings/notifications" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔔</span>
              <div>
                <h3 className="font-semibold text-navy-900 dark:text-white group-hover:text-brand-green transition-colors">Notificaciones</h3>
                <p className="text-xs text-navy-500 dark:text-zinc-400">Configura alertas y preferencias</p>
              </div>
            </div>
          </Link>
          <Link href="/dashboard/settings/integrations" className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow group dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔌</span>
              <div>
                <h3 className="font-semibold text-navy-900 dark:text-white group-hover:text-brand-green transition-colors">Integraciones</h3>
                <p className="text-xs text-navy-500 dark:text-zinc-400">Gmail, Calendar, Sheets</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Theme Preference */}
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-4">Tema</h2>
          <div className="space-y-3">
            <p className="text-sm text-navy-600 dark:text-zinc-400">Selecciona tu preferencia de tema</p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-navy-100 dark:border-zinc-800 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors">
                <input
                  type="radio"
                  name="theme"
                  value="light"
                  checked={themePreference === "light"}
                  onChange={() => handleThemeChange("light")}
                  disabled={savingTheme}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-navy-900 dark:text-white">Claro</p>
                  <p className="text-xs text-navy-500 dark:text-zinc-400">Siempre usar tema claro</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-navy-100 dark:border-zinc-800 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors">
                <input
                  type="radio"
                  name="theme"
                  value="dark"
                  checked={themePreference === "dark"}
                  onChange={() => handleThemeChange("dark")}
                  disabled={savingTheme}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-navy-900 dark:text-white">Oscuro</p>
                  <p className="text-xs text-navy-500 dark:text-zinc-400">Siempre usar tema oscuro</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-navy-100 dark:border-zinc-800 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors">
                <input
                  type="radio"
                  name="theme"
                  value="system"
                  checked={themePreference === "system"}
                  onChange={() => handleThemeChange("system")}
                  disabled={savingTheme}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-navy-900 dark:text-white">Sistema</p>
                  <p className="text-xs text-navy-500 dark:text-zinc-400">Seguir preferencia del sistema operativo</p>
                </div>
              </label>
            </div>
            {savingTheme && <p className="text-sm text-navy-500 dark:text-zinc-400">Guardando...</p>}
          </div>
        </div>

        {/* Profile */}
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-4">Perfil</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div><label className="block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1">Email</label><input type="email" value={email} disabled className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-100 text-navy-500 cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500" /></div>
            <div><label className="block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1">Nombre completo</label><input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white" placeholder="Tu nombre" /></div>
            <div><label className="block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1">Nombre de la empresa</label><input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white" placeholder="Tu empresa" /></div>
            {result.text && <p className={`text-sm ${result.type === "success" ? "text-brand-green" : "text-red-500"}`}>{result.text}</p>}
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold hover:bg-brand-green-dark transition-colors disabled:opacity-50">{saving ? "Guardando..." : "Guardar cambios"}</button>
          </form>
        </div>

        {/* Change Password */}
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-4">Cambiar contrasena</h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div><label className="block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1">Nueva contrasena</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white" placeholder="Minimo 6 caracteres" /></div>
            {passwordResult.text && <p className={`text-sm ${passwordResult.type === "success" ? "text-brand-green" : "text-red-500"}`}>{passwordResult.text}</p>}
            <button type="submit" disabled={savingPassword} className="px-5 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-semibold hover:bg-navy-900 transition-colors disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800">{savingPassword ? "Actualizando..." : "Cambiar contrasena"}</button>
          </form>
        </div>

        {/* Danger Zone */}
        <div className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm dark:border-red-900/30 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Zona peligrosa</h2>
          <p className="text-sm text-navy-600 dark:text-zinc-400 mb-4">Estas acciones son irreversibles. Procede con cuidado.</p>
          <button className="px-5 py-2.5 rounded-xl border border-red-200 dark:border-red-900/50 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">Eliminar cuenta</button>
        </div>
      </div>
    </>
  );
}
