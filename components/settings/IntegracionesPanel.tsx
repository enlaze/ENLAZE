"use client";

/**
 * Ajustes → Integraciones.
 *
 * El flujo OAuth es EXACTAMENTE el de antes:
 *  - conectar  → window.location.assign(`/api/auth/google?module=${module}`)
 *  - el callback vuelve a /dashboard/settings/integrations?integration_success|error
 *  - el estado sale de `agent_connections` (status === "connected" || connected === true)
 *  - desconectar → delete en `agent_connections` tras confirmación
 *  - selector de hoja de Google Sheets sobre `agent_connections.config`
 * Solo cambia la presentación.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  GhostButton,
  HINT,
  IcoCalendar,
  IcoMail,
  IcoMessage,
  IcoSheet,
  IcoWarning,
  PanelHeader,
  PrimaryButton,
  SelectInput,
  TextInput,
} from "@/components/settings/ui";

interface Integration {
  id: string;
  module: string;
  status: string;
  connected?: boolean;
  credentials_ref?: unknown;
  metadata?: unknown;
  config?: unknown;
}

const MODULES = [
  {
    id: "gmail",
    name: "Gmail",
    icon: <IcoMail size={19} />,
    description:
      "Permite al agente leer correos importantes de clientes y proveedores, y redactar respuestas automáticas.",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: <IcoCalendar size={19} />,
    description:
      "Conecta tu agenda para que el agente vea tus huecos libres, te recuerde citas y organice reuniones.",
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    icon: <IcoSheet size={19} />,
    description:
      "Vincula hojas de cálculo para que el agente tenga control de stock, escandallos o ventas en tiempo real.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    icon: <IcoMessage size={19} />,
    description:
      "Envía mensajes reales a tus clientes desde el número de WhatsApp Business de tu empresa.",
  },
];

/** `credentials_ref` / `config` pueden llegar como objeto o como string JSON. */
function parseJsonish(value: unknown): Record<string, unknown> {
  if (!value || value === "") return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown>) || {};
}

export default function IntegracionesPanel() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const confirm = useConfirm();

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  // Selector de hoja de cálculo
  const [availableSheets, setAvailableSheets] = useState<{ id: string; name: string }[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);

  // Formulario de conexión de WhatsApp Business (Meta Cloud API)
  const [showWhatsAppForm, setShowWhatsAppForm] = useState(false);
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);
  const [whatsAppForm, setWhatsAppForm] = useState({
    access_token: "",
    phone_number_id: "",
    whatsapp_business_account_id: "",
  });

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("agent_connections").select("*").eq("user_id", user.id);
      setIntegrations(data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Carga inicial desde Supabase: el setState va dentro de `loadIntegrations`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIntegrations();

    // El callback de Google vuelve con ?integration_success / ?integration_error.
    const params = new URLSearchParams(window.location.search);
    if (params.get("integration_success")) {
      toast.success("Integración conectada");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("integration_error")) {
      toast.error("No se pudo conectar", { description: params.get("integration_error") || undefined });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = (module: string) =>
    integrations.some((i) => i.module === module && (i.status === "connected" || i.connected === true));

  const getMetadata = (module: string) => {
    const integration = integrations.find((i) => i.module === module);
    if (!integration) return {};
    return parseJsonish(integration.credentials_ref ?? integration.metadata);
  };

  const getConfig = (module: string) => {
    const integration = integrations.find((i) => i.module === module);
    if (!integration) return {};
    return parseJsonish(integration.config);
  };

  const handleConnect = (module: string) => {
    if (module === "whatsapp") {
      setShowWhatsAppForm(true);
      return;
    }
    window.location.assign(`/api/auth/google?module=${module}`);
  };

  async function handleDisconnect(module: string, name: string) {
    const ok = await confirm({
      title: `Desconectar ${name}`,
      description: "El agente dejará de tener acceso a esta integración.",
      variant: "danger",
      confirmLabel: "Desconectar",
    });
    if (!ok) return;

    if (module === "whatsapp") {
      const response = await fetch("/api/integrations/whatsapp", { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error("No se pudo desconectar", { description: data?.error || "Error de WhatsApp" });
        return;
      }
      toast.success("WhatsApp desconectado");
      setShowWhatsAppForm(false);
      loadIntegrations();
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("agent_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("module", module);

    if (error) {
      toast.error("No se pudo desconectar", { description: error.message });
      return;
    }

    toast.success(`${name} desconectado`);
    loadIntegrations();
  }

  async function handleSaveWhatsApp() {
    setSavingWhatsApp(true);
    const response = await fetch("/api/integrations/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(whatsAppForm),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error("No se pudo conectar WhatsApp", { description: data?.error || "Revisa los datos de Meta." });
      setSavingWhatsApp(false);
      return;
    }
    toast.success("WhatsApp Business conectado");
    setWhatsAppForm({ access_token: "", phone_number_id: "", whatsapp_business_account_id: "" });
    setShowWhatsAppForm(false);
    await loadIntegrations();
    setSavingWhatsApp(false);
  }

  async function handleFetchSheets() {
    setLoadingSheets(true);
    try {
      const res = await fetch("/api/agent/sheets/list");
      if (res.ok) {
        const data = await res.json();
        setAvailableSheets(data.sheets || []);
        setShowSheetSelector(true);
      } else {
        toast.error("Error cargando hojas", { description: "Revisa que Drive API esté activa." });
      }
    } catch (e) {
      console.error(e);
      toast.error("Error de red", { description: "No se pudieron cargar las hojas." });
    }
    setLoadingSheets(false);
  }

  async function handleSaveSheet(module: string) {
    if (!selectedSheetId) return;
    setSavingSheet(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const selectedSheet = availableSheets.find((s) => s.id === selectedSheetId);
      const newConfig = {
        ...getConfig(module),
        target_spreadsheet_id: selectedSheetId,
        target_spreadsheet_name: selectedSheet?.name || "Hoja Seleccionada",
      };

      const { error } = await supabase
        .from("agent_connections")
        .update({ config: newConfig })
        .eq("user_id", user.id)
        .eq("module", module);

      if (error) toast.error("No se pudo guardar la hoja", { description: error.message });
      else toast.success("Hoja de cálculo actualizada");

      setShowSheetSelector(false);
      loadIntegrations();
    }
    setSavingSheet(false);
  }

  return (
    <div>
      <PanelHeader
        title="Integraciones"
        description="Conecta las herramientas que ya usas para que Enlaze trabaje con tus datos reales."
      />

      {/* Aviso de permisos: se mantiene, sigue siendo relevante. */}
      <div
        style={{
          marginTop: 28,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "16px 18px",
          borderRadius: 14,
          border: "1px solid var(--st-border-strong)",
          background: "var(--st-panel-2)",
        }}
      >
        <span style={{ color: "var(--st-danger)", flex: "none", marginTop: 2 }}>
          <IcoWarning size={16} strokeWidth={2.2} />
        </span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--st-text)" }}>
            Nuevos permisos requeridos
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--st-muted)" }}>
            El agente ya puede <strong style={{ color: "var(--st-text-2)" }}>ejecutar acciones</strong>{" "}
            (escribir borradores, agendar eventos, rellenar hojas). Si conectaste tus cuentas antes,{" "}
            <strong style={{ color: "var(--st-text-2)" }}>desconéctalas y vuelve a conectarlas</strong> para
            conceder los nuevos permisos. Si no, las acciones automáticas fallarán.
          </p>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            marginTop: 32,
            height: 180,
            borderRadius: 16,
            border: "1px solid var(--st-border)",
            background: "var(--st-panel-2)",
          }}
        />
      ) : (
        <div
          data-st-grid2
          style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
        >
          {MODULES.map((mod) => {
            const connected = isConnected(mod.id);
            const metadata = getMetadata(mod.id);
            const sheetConfig = getConfig(mod.id);

            return (
              <div
                key={mod.id}
                style={{
                  padding: 24,
                  border: `1px solid ${connected ? "var(--st-accent)" : "var(--st-border)"}`,
                  borderRadius: 16,
                  background: "var(--st-panel)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      background: "var(--st-field-alt)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--st-text-2)",
                    }}
                  >
                    {mod.icon}
                  </div>
                  {connected ? (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "var(--st-accent-ink)",
                        background: "var(--st-accent-soft)",
                        padding: "4px 10px",
                        borderRadius: 999,
                      }}
                    >
                      Conectado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConnect(mod.id)}
                      data-st-hover="subtle"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "var(--st-text)",
                        background: "transparent",
                        border: "1px solid var(--st-border-strong)",
                        padding: "5px 12px",
                        borderRadius: 9,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "all .16s",
                      }}
                    >
                      Conectar
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 16, fontSize: 16, fontWeight: 700, color: "var(--st-text)" }}>
                  {mod.name}
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--st-muted)" }}>
                  {mod.description}
                </p>

                {connected && typeof metadata.email === "string" && (
                  <p style={{ margin: "10px 0 0", ...HINT }}>
                    Conectado como{" "}
                    <strong style={{ color: "var(--st-text-2)" }}>{metadata.email}</strong>
                  </p>
                )}

                {connected && mod.id === "whatsapp" && (
                  <p style={{ margin: "10px 0 0", ...HINT }}>
                    Número conectado:{" "}
                    <strong style={{ color: "var(--st-text-2)" }}>
                      {typeof metadata.display_phone_number === "string" && metadata.display_phone_number
                        ? metadata.display_phone_number
                        : "verificado por Meta"}
                    </strong>
                  </p>
                )}

                {/* Formulario de conexión de WhatsApp Business */}
                {mod.id === "whatsapp" && showWhatsAppForm && !connected && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid var(--st-border)",
                      background: "var(--st-panel-2)",
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--st-text)" }}>
                      Datos de WhatsApp Cloud API
                    </div>
                    <p style={{ margin: "6px 0 12px", ...HINT }}>
                      Crea un token permanente en Meta Business y copia el identificador del número. El token se
                      guarda cifrado.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <TextInput
                        type="password"
                        value={whatsAppForm.access_token}
                        onChange={(value) => setWhatsAppForm({ ...whatsAppForm, access_token: value })}
                        placeholder="Token permanente de Meta"
                      />
                      <TextInput
                        inputMode="numeric"
                        value={whatsAppForm.phone_number_id}
                        onChange={(value) => setWhatsAppForm({ ...whatsAppForm, phone_number_id: value })}
                        placeholder="ID del número de teléfono"
                      />
                      <TextInput
                        inputMode="numeric"
                        value={whatsAppForm.whatsapp_business_account_id}
                        onChange={(value) =>
                          setWhatsAppForm({ ...whatsAppForm, whatsapp_business_account_id: value })
                        }
                        placeholder="ID de la cuenta de WhatsApp Business (opcional)"
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <PrimaryButton onClick={() => void handleSaveWhatsApp()} disabled={savingWhatsApp}>
                          {savingWhatsApp ? "Verificando…" : "Verificar y conectar"}
                        </PrimaryButton>
                        <GhostButton onClick={() => setShowWhatsAppForm(false)}>Cancelar</GhostButton>
                      </div>
                    </div>
                  </div>
                )}

                {/* Hoja activa de Google Sheets */}
                {connected && mod.id === "google_sheets" && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid var(--st-border)",
                      background: "var(--st-panel-2)",
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--st-text)" }}>
                      Hoja de cálculo activa
                    </div>
                    {typeof sheetConfig.target_spreadsheet_name === "string" ? (
                      <p style={{ margin: "6px 0 10px", ...HINT }}>
                        Actual:{" "}
                        <strong style={{ color: "var(--st-text-2)" }}>
                          {sheetConfig.target_spreadsheet_name}
                        </strong>
                      </p>
                    ) : (
                      <p style={{ margin: "6px 0 10px", fontSize: 12.5, color: "var(--st-danger)" }}>
                        Usando búsqueda automática (última modificada). Mejor fija una.
                      </p>
                    )}

                    {!showSheetSelector ? (
                      <GhostButton onClick={handleFetchSheets} disabled={loadingSheets}>
                        {loadingSheets ? "Cargando hojas…" : "Cambiar hoja…"}
                      </GhostButton>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <SelectInput value={selectedSheetId} onChange={setSelectedSheetId}>
                          <option value="">— Selecciona una hoja —</option>
                          {availableSheets.map((sheet) => (
                            <option key={sheet.id} value={sheet.id}>
                              {sheet.name}
                            </option>
                          ))}
                        </SelectInput>
                        <div style={{ display: "flex", gap: 8 }}>
                          <PrimaryButton
                            onClick={() => handleSaveSheet(mod.id)}
                            disabled={!selectedSheetId || savingSheet}
                          >
                            {savingSheet ? "Guardando…" : "Guardar"}
                          </PrimaryButton>
                          <GhostButton onClick={() => setShowSheetSelector(false)}>Cancelar</GhostButton>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {connected && (
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--st-border)" }}>
                    <GhostButton tone="danger" onClick={() => handleDisconnect(mod.id, mod.name)}>
                      Desconectar
                    </GhostButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
