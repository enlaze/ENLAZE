"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Integration {
  id: string;
  module: string;
  status: string;
  connected?: boolean;
  credentials_ref?: any;
  metadata?: any;
  config?: any;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Sheet selector state
  const [availableSheets, setAvailableSheets] = useState<{id: string, name: string}[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    loadIntegrations();
    
    // Check url params for success or error
    const params = new URLSearchParams(window.location.search);
    if (params.get("integration_success")) {
      // Clear URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const loadIntegrations = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("agent_connections")
        .select("*")
        .eq("user_id", user.id);
      
      setIntegrations(data || []);
    }
    setLoading(false);
  };

  const isConnected = (module: string) => {
    return integrations.some((i) => i.module === module && (i.status === "connected" || i.connected === true));
  };

  const getMetadata = (module: string) => {
    const integration = integrations.find((i) => i.module === module);
    if (!integration) return {};
    
    let data = integration.credentials_ref || integration.metadata;
    if (!data || data === '') return {};
    if (typeof data === 'string') {
      try { 
        return JSON.parse(data); 
      } catch (e) {
        console.error(`Error parsing metadata for ${module}:`, e);
        return {};
      }
    }
    return data || {};
  };

  const getConfig = (module: string) => {
    const integration = integrations.find((i) => i.module === module);
    if (!integration) return {};

    let data = integration.config;
    if (!data || data === '') return {};
    if (typeof data === 'string') {
      try { 
        return JSON.parse(data); 
      } catch (e) {
        console.error(`Error parsing config for ${module}:`, e);
        return {};
      }
    }
    return data || {};
  };

  const handleDisconnect = async (module: string) => {
    if (!confirm(`¿Seguro que quieres desconectar ${module}? El agente dejará de tener acceso.`)) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("agent_connections")
        .delete()
        .eq("user_id", user.id)
        .eq("module", module);
      
      loadIntegrations();
    }
  };

  const handleConnect = (module: string) => {
    window.location.href = `/api/auth/google?module=${module}`;
  };

  const handleFetchSheets = async () => {
    setLoadingSheets(true);
    try {
      const res = await fetch("/api/agent/sheets/list");
      if (res.ok) {
        const data = await res.json();
        setAvailableSheets(data.sheets || []);
        setShowSheetSelector(true);
      } else {
        alert("Error cargando hojas. Revisa que Drive API esté activa.");
      }
    } catch (e) {
      console.error(e);
    }
    setLoadingSheets(false);
  };

  const handleSaveSheet = async (module: string) => {
    if (!selectedSheetId) return;
    setSavingSheet(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const selectedSheet = availableSheets.find(s => s.id === selectedSheetId);
      const existingConfig = getConfig(module);
      
      const newConfig = {
        ...existingConfig,
        target_spreadsheet_id: selectedSheetId,
        target_spreadsheet_name: selectedSheet?.name || "Hoja Seleccionada"
      };

      await supabase
        .from("agent_connections")
        .update({ config: JSON.stringify(newConfig) })
        .eq("user_id", user.id)
        .eq("module", module);
        
      setShowSheetSelector(false);
      loadIntegrations();
    }
    setSavingSheet(false);
  };

  const modules = [
    {
      id: "gmail",
      name: "Gmail",
      icon: "📧",
      description: "Permite al agente leer correos importantes de clientes y proveedores, y redactar respuestas automáticas.",
    },
    {
      id: "google_calendar",
      name: "Google Calendar",
      icon: "📅",
      description: "Conecta tu agenda para que el agente vea tus huecos libres, te recuerde citas y organice reuniones.",
    },
    {
      id: "google_sheets",
      name: "Google Sheets",
      icon: "📊",
      description: "Vincula hojas de cálculo para que el agente tenga control de stock, escandallos o ventas en tiempo real.",
    }
  ];

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-navy-50 dark:hover:bg-zinc-800 transition-colors text-navy-500">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Integraciones</h1>
          <p className="mt-1 text-sm text-navy-600 dark:text-zinc-400">Conecta las herramientas de tu negocio con el agente</p>
        </div>
      </div>

      <div className="space-y-6 max-w-3xl">
        {loading ? (
          <div className="animate-pulse flex space-x-4"><div className="h-20 bg-navy-100 dark:bg-zinc-800 rounded-xl w-full"></div></div>
        ) : (
          modules.map((mod) => {
            const connected = isConnected(mod.id);
            const metadata = getMetadata(mod.id);
            
            return (
              <div key={mod.id} className="space-y-3">
                <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center">
                <div className="flex gap-4">
                  <div className="w-12 h-12 bg-navy-50 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-2xl shrink-0">
                    {mod.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-navy-900 dark:text-white flex items-center gap-2">
                      {mod.name}
                      {connected && <span className="px-2 py-0.5 rounded-full bg-brand-green/10 text-brand-green text-xs font-medium">Conectado</span>}
                    </h3>
                    <p className="text-sm text-navy-600 dark:text-zinc-400 mt-1 max-w-md">{mod.description}</p>
                    
                    {connected && metadata?.email && (
                      <p className="text-xs text-navy-500 dark:text-zinc-500 mt-2">
                        Conectado como: <span className="font-medium text-navy-700 dark:text-zinc-300">{metadata.email}</span>
                      </p>
                    )}
                  </div>
                </div>
                
                <div className="shrink-0 w-full sm:w-auto">
                  {connected ? (
                    <button 
                      onClick={() => handleDisconnect(mod.id)}
                      className="w-full sm:w-auto px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30 text-sm font-medium transition-colors"
                    >
                      Desconectar
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleConnect(mod.id)}
                      className="w-full sm:w-auto px-4 py-2 rounded-lg bg-navy-900 text-white hover:bg-navy-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors"
                    >
                      Conectar
                    </button>
                  )}
                </div>
              </div>
              
              {/* Extra settings for Google Sheets */}
              {connected && mod.id === "google_sheets" && (
                <div className="mt-2 pl-4 sm:pl-20">
                  <div className="p-4 bg-navy-50 dark:bg-zinc-800/50 rounded-xl border border-navy-100 dark:border-zinc-800">
                    <h4 className="text-sm font-semibold text-navy-900 dark:text-white mb-2">Hoja de cálculo activa</h4>
                    {getConfig(mod.id)?.target_spreadsheet_name ? (
                      <p className="text-sm text-navy-700 dark:text-zinc-300 mb-3">
                        Actual: <strong>{getConfig(mod.id).target_spreadsheet_name}</strong>
                      </p>
                    ) : (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
                        Usando búsqueda automática (última modificada). Te recomendamos seleccionar una fija.
                      </p>
                    )}
                    
                    {!showSheetSelector ? (
                      <button 
                        onClick={handleFetchSheets}
                        disabled={loadingSheets}
                        className="text-sm px-3 py-1.5 bg-white dark:bg-zinc-700 border border-navy-200 dark:border-zinc-600 rounded-lg hover:bg-navy-50 dark:hover:bg-zinc-600 transition-colors"
                      >
                        {loadingSheets ? "Cargando hojas..." : "Cambiar hoja..."}
                      </button>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                        <select 
                          className="text-sm p-2 bg-white dark:bg-zinc-900 border border-navy-200 dark:border-zinc-700 rounded-lg max-w-xs w-full"
                          value={selectedSheetId}
                          onChange={(e) => setSelectedSheetId(e.target.value)}
                        >
                          <option value="">-- Selecciona una hoja --</option>
                          {availableSheets.map(sheet => (
                            <option key={sheet.id} value={sheet.id}>{sheet.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleSaveSheet(mod.id)}
                            disabled={!selectedSheetId || savingSheet}
                            className="text-sm px-3 py-1.5 bg-brand-green text-white rounded-lg hover:bg-brand-green/90 transition-colors disabled:opacity-50"
                          >
                            {savingSheet ? "Guardando..." : "Guardar"}
                          </button>
                          <button 
                            onClick={() => setShowSheetSelector(false)}
                            className="text-sm px-3 py-1.5 bg-white dark:bg-zinc-700 border border-navy-200 dark:border-zinc-600 rounded-lg hover:bg-navy-50 dark:hover:bg-zinc-600 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
