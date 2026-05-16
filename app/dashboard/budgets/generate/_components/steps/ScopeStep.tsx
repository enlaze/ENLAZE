"use client";

import React, { useEffect, useState } from "react";
import { useBudgetGenerate } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";

interface ClientOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  client_id: string | null;
}

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none dark:bg-zinc-900 dark:text-white dark:border-zinc-700 text-sm";
const labelCls = "block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1";

export function ScopeStep() {
  const { state, updateState } = useBudgetGenerate();
  const { serviceTypes } = useSector();
  const supabase = createClient();
  
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const [clientsRes, projectsRes] = await Promise.all([
        supabase.from("clients").select("id, name").eq("user_id", user.id).order("name"),
        supabase.from("projects").select("id, name, client_id").eq("user_id", user.id).order("name")
      ]);
      
      if (clientsRes.data) setClients(clientsRes.data);
      if (projectsRes.data) setProjects(projectsRes.data);
      setLoading(false);
    }
    loadData();
  }, []);

  // Filter projects by selected client if any
  const visibleProjects = state.clientId 
    ? projects.filter(p => p.client_id === state.clientId)
    : projects;

  // Auto-clear project if client changes and project doesn't belong to client
  useEffect(() => {
    if (state.clientId && state.projectId) {
      const projectStillValid = projects.some(p => p.id === state.projectId && p.client_id === state.clientId);
      if (!projectStillValid && state.projectId !== "NEW") {
        updateState({ projectId: "" });
      }
    }
  }, [state.clientId, state.projectId, projects]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !state.clientId) return;
    setIsSavingProject(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.from("projects").insert({
        name: newProjectName.trim(),
        client_id: state.clientId,
        user_id: user.id,
        service_type: state.serviceType || state.sector || "general",
        start_date: state.startDate || null,
      }).select("id, name, client_id").single();

      if (data && !error) {
        setProjects(prev => [...prev, data]);
        updateState({ projectId: data.id });
        setIsCreatingProject(false);
        setNewProjectName("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingProject(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <h2 className="text-xl font-bold text-navy-900 dark:text-white mb-4">Alcance del proyecto</h2>
        <p className="text-sm text-navy-600 dark:text-zinc-400 mb-6">
          Define el tipo de proyecto y el nivel de calidad deseado. La IA utilizará esto para sugerir partidas y materiales.
        </p>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>Título del presupuesto <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={state.title || ""}
                onChange={(e) => updateState({ title: e.target.value })}
                placeholder="Ej: Reforma baño completo"
                className={inputCls}
                required
              />
            </div>
            
            <div>
              <label className={labelCls}>Cliente asociado</label>
              <select 
                value={state.clientId || ""} 
                onChange={(e) => updateState({ clientId: e.target.value })} 
                className={inputCls}
                disabled={loading}
              >
                <option value="">Sin asignar</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className={labelCls}>Obra/Proyecto asociado</label>
              {!isCreatingProject ? (
                <div className="flex gap-2">
                  <select 
                    value={state.projectId || ""} 
                    onChange={(e) => {
                      if (e.target.value === "NEW") {
                        setIsCreatingProject(true);
                        updateState({ projectId: "" });
                      } else {
                        updateState({ projectId: e.target.value });
                      }
                    }} 
                    className={inputCls}
                    disabled={loading || !state.clientId}
                  >
                    {!state.clientId ? (
                      <option value="">Selecciona un cliente primero</option>
                    ) : (
                      <>
                        <option value="">{visibleProjects.length === 0 ? "Sin obras (Crea una nueva)" : "Sin asignar"}</option>
                        {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        <option value="NEW" className="font-bold text-brand-green bg-brand-green/10">
                          + Crear nueva obra/proyecto
                        </option>
                      </>
                    )}
                  </select>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Nombre de la nueva obra..."
                    className={inputCls}
                    autoFocus
                  />
                  <button 
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || isSavingProject}
                    className="bg-brand-green hover:bg-brand-green/90 text-navy-900 px-3 rounded-lg font-bold disabled:opacity-50 whitespace-nowrap text-sm"
                  >
                    {isSavingProject ? "..." : "Crear"}
                  </button>
                  <button 
                    onClick={() => setIsCreatingProject(false)}
                    className="bg-navy-100 hover:bg-navy-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-3 rounded-lg text-sm"
                  >
                    ✕
                  </button>
                </div>
              )}
              {state.validationError && state.validationError.includes("obra") && (
                <p className="text-red-500 text-xs mt-1 font-medium">{state.validationError}</p>
              )}
            </div>

            <div>
              <label className={labelCls}>Tipo de obra</label>
              <select 
                value={state.serviceType || state.sector || ""} 
                onChange={(e) => updateState({ serviceType: e.target.value })} 
                className={inputCls}
              >
                {(() => {
                  const sTypes = serviceTypes();
                  const fallbackServiceTypes = [
                    { value: "reforma", label: "Reforma integral" },
                    { value: "fontaneria", label: "Fontanería" },
                    { value: "electricidad", label: "Electricidad" },
                    { value: "general", label: "General" },
                  ];
                  const activeServiceTypes = sTypes.length > 0 ? sTypes : fallbackServiceTypes;
                  return activeServiceTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>);
                })()}
              </select>
            </div>
            
            <div>
              <label className={labelCls}>Fecha prevista de inicio</label>
              <input 
                type="date" 
                value={state.startDate || ""} 
                onChange={(e) => updateState({ startDate: e.target.value })} 
                className={inputCls} 
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Descripción general para la IA</label>
            <textarea 
              className="w-full bg-white dark:bg-zinc-900 border border-navy-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green outline-none min-h-[100px]"
              placeholder="Ej: Reforma integral de piso de 80m2 con cambio de distribución..."
              value={state.description}
              onChange={(e) => updateState({ description: e.target.value })}
            />
          </div>
          
          {state.validationError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm font-medium">
              {state.validationError}
            </div>
          )}
        </div>
      </Card>
      
      {/* Placeholder para más campos de alcance (Estancias, calidades, etc) */}
      <Card>
        <div className="flex items-center justify-center p-8 border-2 border-dashed border-navy-100 dark:border-zinc-800 rounded-xl">
          <p className="text-navy-500 dark:text-zinc-500 text-sm">Próximamente: Selector visual de estancias y calidades</p>
        </div>
      </Card>
    </div>
  );
}
