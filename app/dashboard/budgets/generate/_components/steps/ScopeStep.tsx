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

const ESTANCIAS = [
  { value: "vivienda_completa", label: "Vivienda completa" },
  { value: "cocina", label: "Cocina" },
  { value: "bano_1", label: "Bano 1" },
  { value: "bano_2", label: "Bano 2" },
  { value: "salon", label: "Salon" },
  { value: "dormitorios", label: "Dormitorios" },
  { value: "pasillo", label: "Pasillo / Recibidor" },
  { value: "terraza", label: "Terraza / Balcon" },
  { value: "otros", label: "Otros" },
];

const ACTUACIONES = [
  { value: "demoliciones", label: "Demoliciones" },
  { value: "albanileria", label: "Albanileria / Tabiqueria" },
  { value: "electricidad", label: "Electricidad" },
  { value: "fontaneria", label: "Fontaneria" },
  { value: "climatizacion", label: "Climatizacion" },
  { value: "alicatados", label: "Alicatados / Revestimientos" },
  { value: "pavimentos", label: "Pavimentos" },
  { value: "pintura", label: "Pintura" },
  { value: "carpinteria_interior", label: "Carpinteria interior" },
  { value: "carpinteria_exterior", label: "Carpinteria exterior / Ventanas" },
  { value: "cocina_montaje", label: "Cocina (muebles y equipamiento)" },
  { value: "banos_sanitarios", label: "Banos / Sanitarios" },
  { value: "iluminacion", label: "Iluminacion" },
  { value: "limpieza_final", label: "Limpieza final" },
  { value: "gestion_residuos", label: "Gestion de residuos" },
];

const CALIDADES = [
  { value: "basica", label: "Basica", description: "Materiales estandar, acabados funcionales" },
  { value: "media", label: "Media", description: "Materiales de gama media, acabados cuidados" },
  { value: "alta", label: "Alta", description: "Materiales premium, acabados de alta calidad" },
];

export function ScopeStep() {
  const { state, updateState, updateSectorData } = useBudgetGenerate();
  const { serviceTypes } = useSector();
  const supabase = createClient();

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);

  // Read scope data from sectorData
  const scopeData = state.sectorData || {};
  const selectedEstancias: string[] = scopeData.estancias || [];
  const selectedActuaciones: string[] = scopeData.actuaciones || [];
  const selectedCalidad: string = scopeData.calidad || "media";
  const superficieM2: number = scopeData.superficie_m2 || 0;
  const numBanos: number = scopeData.num_banos || 1;
  const incluyeCocina: boolean = scopeData.incluye_cocina ?? true;
  const incluyeVentanas: boolean = scopeData.incluye_ventanas ?? false;
  const incluyeClimatizacion: boolean = scopeData.incluye_climatizacion ?? false;

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

  const toggleEstancia = (value: string) => {
    const next = selectedEstancias.includes(value)
      ? selectedEstancias.filter(v => v !== value)
      : [...selectedEstancias, value];
    updateSectorData("estancias", next);
  };

  const toggleActuacion = (value: string) => {
    const next = selectedActuaciones.includes(value)
      ? selectedActuaciones.filter(v => v !== value)
      : [...selectedActuaciones, value];
    updateSectorData("actuaciones", next);
  };

  const isConstruction = state.sector === "construccion";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <h2 className="text-xl font-bold text-navy-900 dark:text-white mb-4">Alcance del proyecto</h2>
        <p className="text-sm text-navy-600 dark:text-zinc-400 mb-6">
          Define el tipo de proyecto y el nivel de calidad deseado. La IA utilizara esto para sugerir partidas y materiales.
        </p>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>Titulo del presupuesto <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={state.title || ""}
                onChange={(e) => updateState({ title: e.target.value })}
                placeholder="Ej: Reforma bano completo"
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
                    X
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
                    { value: "fontaneria", label: "Fontaneria" },
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
            <label className={labelCls}>Descripcion general para la IA</label>
            <textarea
              className="w-full bg-white dark:bg-zinc-900 border border-navy-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green outline-none min-h-[100px]"
              placeholder="Ej: Reforma integral de piso de 80m2 con cambio de distribucion..."
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

      {/* Selector visual de estancias y calidades - V1 */}
      {isConstruction && (
        <Card>
          <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-1">Alcance detallado</h2>
          <p className="text-sm text-navy-500 dark:text-zinc-400 mb-5">
            Selecciona las estancias, actuaciones y calidad. Esto alimenta al analisis IA para generar partidas mas precisas.
          </p>

          {/* Superficie y extras */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div>
              <label className={labelCls}>Superficie total (m2)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={superficieM2 || ""}
                onChange={(e) => updateSectorData("superficie_m2", parseInt(e.target.value) || 0)}
                placeholder="Ej: 90"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>N. de banos</label>
              <input
                type="number"
                min="0"
                max="10"
                step="1"
                value={numBanos}
                onChange={(e) => updateSectorData("num_banos", parseInt(e.target.value) || 0)}
                className={inputCls}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-navy-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={incluyeCocina}
                  onChange={(e) => updateSectorData("incluye_cocina", e.target.checked)}
                  className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                />
                Incluye cocina
              </label>
            </div>
            <div className="flex flex-col gap-1.5 justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-navy-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={incluyeVentanas}
                  onChange={(e) => updateSectorData("incluye_ventanas", e.target.checked)}
                  className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                />
                Cambio ventanas
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-navy-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={incluyeClimatizacion}
                  onChange={(e) => updateSectorData("incluye_climatizacion", e.target.checked)}
                  className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                />
                Climatizacion
              </label>
            </div>
          </div>

          {/* Estancias */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-navy-800 dark:text-zinc-200 mb-2">Estancias afectadas</h3>
            <div className="flex flex-wrap gap-2">
              {ESTANCIAS.map(e => {
                const active = selectedEstancias.includes(e.value);
                return (
                  <button
                    key={e.value}
                    onClick={() => toggleEstancia(e.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      active
                        ? "bg-brand-green/20 text-brand-green border-brand-green/40 dark:bg-brand-green/10"
                        : "bg-white dark:bg-zinc-800 text-navy-600 dark:text-zinc-400 border-navy-200 dark:border-zinc-700 hover:border-brand-green/30"
                    }`}
                  >
                    {active ? "V " : ""}{e.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actuaciones */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-navy-800 dark:text-zinc-200 mb-2">Actuaciones previstas</h3>
            <div className="flex flex-wrap gap-2">
              {ACTUACIONES.map(a => {
                const active = selectedActuaciones.includes(a.value);
                return (
                  <button
                    key={a.value}
                    onClick={() => toggleActuacion(a.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      active
                        ? "bg-brand-green/20 text-brand-green border-brand-green/40 dark:bg-brand-green/10"
                        : "bg-white dark:bg-zinc-800 text-navy-600 dark:text-zinc-400 border-navy-200 dark:border-zinc-700 hover:border-brand-green/30"
                    }`}
                  >
                    {active ? "V " : ""}{a.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calidad */}
          <div>
            <h3 className="text-sm font-semibold text-navy-800 dark:text-zinc-200 mb-2">Nivel de calidad</h3>
            <div className="grid grid-cols-3 gap-3">
              {CALIDADES.map(c => {
                const active = selectedCalidad === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => updateSectorData("calidad", c.value)}
                    className={`p-3 rounded-xl border text-left transition ${
                      active
                        ? "border-brand-green bg-brand-green/5 dark:bg-brand-green/10"
                        : "border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-brand-green/30"
                    }`}
                  >
                    <div className={`text-sm font-bold ${active ? "text-brand-green" : "text-navy-900 dark:text-white"}`}>
                      {c.label}
                    </div>
                    <div className="text-[11px] text-navy-500 dark:text-zinc-400 mt-0.5">{c.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
