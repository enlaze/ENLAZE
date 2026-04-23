"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Integration {
  id: string;
  module: string;
  status: string;
  metadata: any;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
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
    return integrations.some((i) => i.module === module && i.status === "connected");
  };

  const getMetadata = (module: string) => {
    const integration = integrations.find((i) => i.module === module);
    return integration?.metadata;
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
              <div key={mod.id} className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center">
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
            );
          })
        )}
      </div>
    </>
  );
}
