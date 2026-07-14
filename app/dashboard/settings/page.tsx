"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "@/lib/theme-context";
import Link from "next/link";

type ThemePreference = "light" | "dark" | "system";

/* ─── Lucide icons (inline, strokeWidth 2, stroke=currentColor) ─────── */

const svgBase = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

function IcoBuilding({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /><path d="M10 18h4" />
    </svg>
  );
}

function IcoReceipt({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M14 8H8" /><path d="M16 12H8" /><path d="M13 16H8" />
    </svg>
  );
}

function IcoBell({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function IcoPlug({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

function IcoChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IcoSun({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" /><path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function IcoMoon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function IcoUser({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IcoKey({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function IcoLock({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IcoAlert({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}

function IcoTrash({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  );
}

function IcoCheckCircle({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#00c896" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" stroke="none" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const NAV_CARDS = [
  { href: "/dashboard/settings/sector", icon: <IcoBuilding />, title: "Sector de actividad", desc: "Adapta Enlaze a tu sector" },
  { href: "/dashboard/settings/fiscal", icon: <IcoReceipt />, title: "Ajustes fiscales", desc: "NIF, IVA, series, Verifactu" },
  { href: "/dashboard/settings/notifications", icon: <IcoBell />, title: "Notificaciones", desc: "Configura alertas y preferencias" },
  { href: "/dashboard/settings/integrations", icon: <IcoPlug />, title: "Integraciones", desc: "Gmail, Calendar, Sheets" },
];

const THEME_OPTIONS: { id: ThemePreference; name: string; desc: string; icon: React.ReactNode }[] = [
  { id: "light", name: "Claro", desc: "Siempre usar tema claro", icon: <IcoSun /> },
  { id: "dark", name: "Oscuro", desc: "Siempre usar tema oscuro", icon: <IcoMoon /> },
];

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
  const { setTheme } = useTheme();
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
        if (data) { setFullName(data.full_name || ""); setCompanyName(data.business_name || ""); }
      }
    };
    load();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setResult({ type: "", text: "" });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setResult({ type: "error", text: "No hay sesión activa. Vuelve a iniciar sesión." });
      setSaving(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        full_name: fullName,
        business_name: companyName,
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error("[settings/profile] upsert error:", profileError);
      setResult({
        type: "error",
        text: `Error al guardar el perfil: ${profileError.message}${profileError.code ? ` (code ${profileError.code})` : ""}`,
      });
      setSaving(false);
      return;
    }

    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (authError) {
      console.error("[settings/profile] auth.updateUser error:", authError);
    }

    setResult({ type: "success", text: "Perfil actualizado correctamente" });
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
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6">
      {/* Header */}
      <div className="mb-1 flex flex-col gap-1">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-[#0f1e1a] dark:text-white">Ajustes</h1>
        <p className="text-[15px] text-[#6b7d76] dark:text-zinc-400">Configura tu perfil y cuenta</p>
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {NAV_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex items-center gap-4 rounded-2xl border border-[#e5eae8] bg-white p-5 shadow-[0_1px_3px_rgba(15,30,26,0.04)] transition-all hover:border-[#c8f0e2] hover:shadow-[0_3px_10px_rgba(0,200,150,0.08)] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-green/40"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f0f3f5] text-[#5c6f7a] dark:bg-zinc-800 dark:text-zinc-300">
              {card.icon}
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <h3 className="text-[15.5px] font-bold text-[#0f1e1a] dark:text-white">{card.title}</h3>
              <p className="text-[13.5px] text-[#6b7d76] dark:text-zinc-400">{card.desc}</p>
            </div>
            <span className="shrink-0 text-[#9aa8a2] dark:text-zinc-500">
              <IcoChevronRight />
            </span>
          </Link>
        ))}
      </div>

      {/* Theme */}
      <div className="rounded-2xl border border-[#e5eae8] bg-white p-[26px] shadow-[0_1px_3px_rgba(15,30,26,0.04)] dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-[17px] font-bold text-[#0f1e1a] dark:text-white">Tema</div>
        <div className="mt-[3px] text-[14px] text-[#6b7d76] dark:text-zinc-400">Selecciona tu preferencia de tema</div>
        <div className="mt-[18px] grid grid-cols-2 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const selected = themePreference === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleThemeChange(opt.id)}
                disabled={savingTheme}
                className={`relative flex cursor-pointer flex-col items-center gap-2.5 rounded-[14px] px-4 py-[18px] text-center transition-all disabled:cursor-not-allowed ${
                  selected
                    ? "border-[1.5px] border-brand-green bg-[#f4fdfa] shadow-[0_2px_8px_rgba(0,200,150,0.10)] dark:bg-brand-green/[0.08]"
                    : "border border-[#e5eae8] bg-white hover:border-[#c8f0e2] hover:bg-[#fbfefd] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-green/30 dark:hover:bg-zinc-800/50"
                }`}
              >
                {selected && (
                  <span className="absolute right-2.5 top-2.5">
                    <IcoCheckCircle />
                  </span>
                )}
                <span
                  className={`flex h-[42px] w-[42px] items-center justify-center rounded-xl ${
                    selected
                      ? "bg-[#e6faf4] text-brand-green-dark dark:bg-brand-green/15 dark:text-brand-green"
                      : "bg-[#f0f3f5] text-[#5c6f7a] dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className={`text-[14.5px] font-bold ${selected ? "text-[#0f1e1a] dark:text-white" : "text-[#3d4f48] dark:text-zinc-200"}`}>{opt.name}</span>
                  <span className={`text-[12.5px] leading-snug ${selected ? "text-[#6b7d76] dark:text-zinc-400" : "text-[#9aa8a2] dark:text-zinc-500"}`}>{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile */}
      <div className="rounded-2xl border border-[#e5eae8] bg-white p-[26px] shadow-[0_1px_3px_rgba(15,30,26,0.04)] dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#f0f3f5] text-[#5c6f7a] dark:bg-zinc-800 dark:text-zinc-300">
            <IcoUser />
          </div>
          <div className="text-[17px] font-bold text-[#0f1e1a] dark:text-white">Perfil</div>
        </div>

        <form onSubmit={handleSaveProfile} className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13.5px] font-semibold text-[#3d4f48] dark:text-zinc-300">Email</label>
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[#e5eae8] bg-[#f0f4f2] px-3.5 py-3 text-[14.5px] text-[#6b7d76] dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
              <span className="text-[#9aa8a2] dark:text-zinc-500"><IcoLock /></span>
              {email}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13.5px] font-semibold text-[#3d4f48] dark:text-zinc-300">Nombre completo</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Tu nombre"
                className="w-full rounded-[10px] border border-[#d4ddd9] bg-white px-3.5 py-3 text-[14.5px] text-[#0f1e1a] outline-none placeholder:text-[#9aa8a2] focus:border-brand-green focus:ring-[3px] focus:ring-brand-green/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13.5px] font-semibold text-[#3d4f48] dark:text-zinc-300">Nombre de la empresa</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Tu empresa"
                className="w-full rounded-[10px] border border-[#d4ddd9] bg-white px-3.5 py-3 text-[14.5px] text-[#0f1e1a] outline-none placeholder:text-[#9aa8a2] focus:border-brand-green focus:ring-[3px] focus:ring-brand-green/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </div>
          </div>
          {result.text && <p className={`text-[13.5px] ${result.type === "success" ? "text-brand-green-dark dark:text-brand-green" : "text-red-500"}`}>{result.text}</p>}
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[10px] bg-brand-green px-[22px] py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#00b586] disabled:opacity-50 dark:text-zinc-950"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </div>

      {/* Change Password */}
      <div className="rounded-2xl border border-[#e5eae8] bg-white p-[26px] shadow-[0_1px_3px_rgba(15,30,26,0.04)] dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#f0f3f5] text-[#5c6f7a] dark:bg-zinc-800 dark:text-zinc-300">
            <IcoKey />
          </div>
          <div className="text-[17px] font-bold text-[#0f1e1a] dark:text-white">Cambiar contraseña</div>
        </div>

        <form onSubmit={handleChangePassword} className="mt-5 flex flex-col gap-3">
          <div className="flex flex-col items-end gap-3.5 sm:flex-row">
            <div className="flex w-full flex-1 flex-col gap-1.5">
              <label className="text-[13.5px] font-semibold text-[#3d4f48] dark:text-zinc-300">Nueva contraseña</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                className="w-full rounded-[10px] border border-[#d4ddd9] bg-white px-3.5 py-3 text-[14.5px] text-[#0f1e1a] outline-none placeholder:text-[#9aa8a2] focus:border-brand-green focus:ring-[3px] focus:ring-brand-green/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="w-full shrink-0 rounded-[10px] bg-[#0f1e1a] px-[22px] py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#22332d] disabled:opacity-50 sm:w-auto dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              {savingPassword ? "Actualizando..." : "Cambiar contraseña"}
            </button>
          </div>
          {passwordResult.text && <p className={`text-[13.5px] ${passwordResult.type === "success" ? "text-brand-green-dark dark:text-brand-green" : "text-red-500"}`}>{passwordResult.text}</p>}
        </form>
      </div>

      {/* Danger Zone */}
      <div className="rounded-2xl border border-[#f5d5d5] bg-[#fffafa] p-[26px] dark:border-red-900/30 dark:bg-red-950/10">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#fdeeee] text-[#d64545] dark:bg-red-950/40 dark:text-red-400">
            <IcoAlert />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[17px] font-bold text-[#c03535] dark:text-red-400">Zona peligrosa</div>
            <div className="text-[13.5px] text-[#a96a6a] dark:text-red-400/70">Estas acciones son irreversibles. Procede con cuidado.</div>
          </div>
        </div>
        <button className="mt-[18px] flex items-center gap-2 rounded-[10px] border border-[#f0bcbc] bg-white px-[18px] py-[11px] text-[14px] font-semibold text-[#d64545] transition-colors hover:border-[#e89a9a] hover:bg-[#fdeeee] dark:border-red-900/50 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/20">
          <IcoTrash />
          Eliminar cuenta
        </button>
      </div>
    </div>
  );
}
