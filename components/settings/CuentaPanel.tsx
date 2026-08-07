"use client";

/**
 * Ajustes → Cuenta y tema.
 *
 * Conserva sin tocar los tres flujos que ya existían en /settings:
 *  - preferencia de tema vía `useTheme().setTheme` (claro / oscuro / sistema),
 *  - nombre del titular en `profiles.full_name` + user_metadata,
 *  - cambio de contraseña con `supabase.auth.updateUser`,
 *  - BORRADO DE CUENTA: mismo `useConfirm` con requireText "ELIMINAR", el mismo
 *    aviso de retención legal y el mismo POST a /api/account/delete.
 *    Aquí solo cambia el aspecto del botón que lo abre.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "@/lib/theme-context";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  CARD,
  Field,
  IcoLock,
  IcoMonitor,
  IcoMoon,
  IcoSun,
  PanelHeader,
  PrimaryButton,
  TextInput,
} from "@/components/settings/ui";

type ThemePreference = "light" | "dark" | "system";

const THEME_CARDS: { id: ThemePreference; name: string; desc: string; icon: React.ReactNode }[] = [
  { id: "light", name: "Claro", desc: "Siempre usar tema claro", icon: <IcoSun /> },
  { id: "dark", name: "Oscuro", desc: "Siempre usar tema oscuro", icon: <IcoMoon /> },
  { id: "system", name: "Sistema", desc: "Seguir la preferencia del dispositivo", icon: <IcoMonitor /> },
];

export default function CuentaPanel() {
  const supabase = useMemo(() => createClient(), []);
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [savedFullName, setSavedFullName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [savingTheme, setSavingTheme] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setEmail(user.email || "");
    const metaName = user.user_metadata?.full_name || "";
    const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const name = data?.full_name || metaName;
    setFullName(name);
    setSavedFullName(name);
  }, [supabase]);

  useEffect(() => {
    // Carga inicial desde Supabase: el setState va dentro de `load`, tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleSaveProfile() {
    setSavingProfile(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("No hay sesión activa", { description: "Vuelve a iniciar sesión." });
      setSavingProfile(false);
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: fullName,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[settings/profile] upsert error:", error);
      toast.error("Error al guardar el perfil", {
        description: `${error.message}${error.code ? ` (code ${error.code})` : ""}`,
      });
      setSavingProfile(false);
      return;
    }

    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (authError) console.error("[settings/profile] auth.updateUser error:", authError);

    setSavedFullName(fullName);
    toast.success("Perfil actualizado correctamente");
    setSavingProfile(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error("No se pudo cambiar la contraseña", { description: error.message });
    else {
      toast.success("Contraseña actualizada correctamente");
      setNewPassword("");
    }
    setSavingPassword(false);
  }

  async function handleThemeChange(next: ThemePreference) {
    setSavingTheme(true);
    try {
      await setTheme(next);
    } catch (error) {
      console.error("Error saving theme preference:", error);
      toast.error("Error al guardar la preferencia de tema");
    }
    setSavingTheme(false);
  }

  /* ── BORRADO DE CUENTA — flujo intacto ─────────────────────────────── */
  async function handleDeleteAccount() {
    setDeleteError("");

    const confirmed = await confirm({
      title: "Eliminar cuenta permanentemente",
      description:
        "Se borrarán tu perfil y tus datos: clientes, proyectos, presupuestos, proveedores, precios y documentos. Esta acción es irreversible y no podrás recuperar la información.",
      variant: "danger",
      confirmLabel: "Eliminar cuenta",
      cancelLabel: "Cancelar",
      requireText: "ELIMINAR",
      details: (
        <div className="mt-4 rounded-[10px] border border-[#e5eae8] bg-[#f7faf9] p-3.5 text-[13px] leading-relaxed text-[#3d4f48] dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
          Por obligación legal se conservarán, <strong>desvinculadas de tu identidad</strong>, tus{" "}
          <strong>facturas emitidas y recibidas</strong> (Hacienda exige guardarlas unos 4 años) y
          la <strong>prueba de los consentimientos</strong> que aceptaste. Ya no estarán asociadas
          a tu cuenta ni serán accesibles desde Enlaze.
        </div>
      ),
    });
    if (!confirmed) return;

    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "ELIMINAR" }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDeleteError(data?.error || "No se pudo eliminar la cuenta. Inténtalo de nuevo.");
        setDeletingAccount(false);
        return;
      }

      await supabase.auth.signOut();
      // Navegación dura: limpia todo el estado del cliente tras el borrado.
      window.location.href = "/?cuenta=eliminada";
    } catch (error) {
      console.error("[settings/delete-account]", error);
      setDeleteError("Error de conexión. No se ha eliminado la cuenta.");
      setDeletingAccount(false);
    }
  }

  return (
    <div>
      <PanelHeader
        title="Cuenta y tema"
        description="Tu acceso, tu apariencia y las acciones irreversibles."
      />

      {/* ── Tema ── */}
      <div style={{ ...CARD, marginTop: 32, padding: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-text)" }}>Tema</div>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--st-muted)" }}>
          Selecciona tu preferencia de apariencia.
        </p>
        <div
          data-st-grid2
          style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}
        >
          {THEME_CARDS.map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleThemeChange(opt.id)}
                disabled={savingTheme}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 10,
                  textAlign: "left",
                  padding: 20,
                  borderRadius: 14,
                  cursor: savingTheme ? "wait" : "pointer",
                  fontFamily: "inherit",
                  background: active ? "var(--st-accent-soft)" : "var(--st-panel)",
                  border: `1.5px solid ${active ? "var(--st-accent)" : "var(--st-border)"}`,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "var(--st-field-alt)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--st-accent)",
                  }}
                >
                  {opt.icon}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--st-text)" }}>{opt.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--st-muted)" }}>{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Perfil ── */}
      <div style={{ ...CARD, marginTop: 24, padding: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-text)" }}>Perfil</div>

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 20, maxWidth: 460 }}>
          <Field label="Email" hint="Tu email de acceso no se puede modificar desde aquí.">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: 44,
                padding: "0 14px",
                border: "1px solid var(--st-border)",
                borderRadius: 11,
                background: "var(--st-field-alt)",
                color: "var(--st-muted)",
                fontSize: 14.5,
                fontWeight: 500,
              }}
            >
              <IcoLock />
              {email}
            </div>
          </Field>

          <Field label="Nombre del titular" hint="Cómo te saluda tu agente en el briefing.">
            <TextInput value={fullName} onChange={setFullName} placeholder="Tu nombre" />
          </Field>

          <div>
            <PrimaryButton
              onClick={handleSaveProfile}
              disabled={savingProfile || fullName === savedFullName}
            >
              {savingProfile ? "Guardando…" : "Guardar perfil"}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {/* ── Contraseña ── */}
      <div style={{ ...CARD, marginTop: 24, padding: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-text)" }}>Contraseña</div>
        <form
          onSubmit={handleChangePassword}
          style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 20, maxWidth: 460 }}
        >
          <Field label="Nueva contraseña" hint="Mínimo 6 caracteres.">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                border: "1px solid var(--st-border-strong)",
                borderRadius: 11,
                background: "var(--st-field)",
                color: "var(--st-text)",
                fontSize: 14.5,
                fontWeight: 500,
                outline: "none",
              }}
            />
          </Field>
          <div>
            <PrimaryButton type="submit" disabled={savingPassword || newPassword.length < 6}>
              {savingPassword ? "Actualizando…" : "Cambiar contraseña"}
            </PrimaryButton>
          </div>
        </form>
      </div>

      {/* ── Eliminar cuenta ── */}
      <div
        style={{
          marginTop: 24,
          padding: 28,
          border: "1px solid var(--st-border)",
          borderRadius: 18,
          background: "var(--st-danger-soft)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-danger)" }}>Eliminar cuenta</div>
        <p
          style={{
            margin: "8px 0 18px",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--st-text-2)",
            maxWidth: "62ch",
          }}
        >
          Se borran tus datos, facturas y clientes de forma permanente. Por obligación legal se conservan,
          desvinculadas de tu identidad, tus facturas y la prueba de los consentimientos durante unos 4 años.
        </p>
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={deletingAccount}
          data-st-hover="danger"
          style={{
            height: 42,
            padding: "0 18px",
            borderRadius: 11,
            border: "1px solid var(--st-danger)",
            background: "transparent",
            color: "var(--st-danger)",
            fontSize: 14,
            fontWeight: 700,
            cursor: deletingAccount ? "wait" : "pointer",
            fontFamily: "inherit",
            transition: "all .16s",
          }}
        >
          {deletingAccount ? "Eliminando cuenta…" : "Eliminar mi cuenta"}
        </button>
        {deleteError && (
          <p style={{ margin: "12px 0 0", fontSize: 13.5, fontWeight: 600, color: "var(--st-danger)" }}>
            {deleteError}
          </p>
        )}
      </div>
    </div>
  );
}
