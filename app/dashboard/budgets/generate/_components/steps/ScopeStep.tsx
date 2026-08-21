"use client";

import React, { useEffect, useState } from "react";
import { useBudgetGenerate } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import { useToast } from "@/components/ui/toast";
import { FileText, Ruler, UploadCloud } from "lucide-react";
import { getGeographicCostProfile } from "@/lib/geographic-costs";
import { normalizeBathroomCount } from "@/lib/budget-engine";
import { BudgetTermsFields } from "../BudgetTermsFields";

interface ClientOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
  client_id: string | null;
}

interface TechnicalDocumentOption {
  id: string;
  name: string;
  doc_type: string;
  mime_type: string;
  file_url: string;
  created_at: string;
}

const inputCls =
  "w-full bg-white text-navy-900 rounded-lg px-4 py-2.5 border border-navy-200 focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none dark:bg-zinc-900 dark:text-white dark:border-zinc-700 text-sm";
const labelCls = "block text-sm font-medium text-navy-700 dark:text-zinc-300 mb-1";

const ESTANCIAS = [
  { value: "vivienda_completa", label: "Vivienda completa" },
  { value: "cocina", label: "Cocina" },
  { value: "bano_1", label: "Baño 1" },
  { value: "bano_2", label: "Baño 2" },
  { value: "salon", label: "Salón" },
  { value: "dormitorios", label: "Dormitorios" },
  { value: "pasillo", label: "Pasillo / Recibidor" },
  { value: "terraza", label: "Terraza / Balcón" },
  { value: "otros", label: "Otros" },
];

const ACTUACIONES = [
  { value: "demoliciones", label: "Demoliciones" },
  { value: "albanileria", label: "Albañilería / Tabiquería" },
  { value: "electricidad", label: "Electricidad" },
  { value: "fontaneria", label: "Fontanería" },
  { value: "climatizacion", label: "Climatización" },
  { value: "alicatados", label: "Alicatados / Revestimientos" },
  { value: "pavimentos", label: "Pavimentos" },
  { value: "pintura", label: "Pintura" },
  { value: "carpinteria_interior", label: "Carpintería interior" },
  { value: "carpinteria_exterior", label: "Carpintería exterior / Ventanas" },
  { value: "cocina_montaje", label: "Cocina (muebles y equipamiento)" },
  { value: "banos_sanitarios", label: "Baños / Sanitarios" },
  { value: "iluminacion", label: "Iluminación" },
  { value: "limpieza_final", label: "Limpieza final" },
  { value: "gestion_residuos", label: "Gestión de residuos" },
];

const CALIDADES = [
  { value: "basica", label: "Básica", description: "Materiales estándar, acabados funcionales" },
  { value: "media", label: "Media", description: "Materiales de gama media, acabados cuidados" },
  { value: "alta", label: "Alta", description: "Materiales premium, acabados de alta calidad" },
];

const PROJECT_CONTEXTS = [
  {
    value: "existing_renovation",
    label: "Reforma de edificio existente",
    description: "Se parte de lo construido y se conserva lo que no se haya marcado para sustituir.",
  },
  {
    value: "rehabilitation",
    label: "Rehabilitación",
    description: "Edificio existente con patologías, envolvente o instalaciones que requieren diagnóstico.",
  },
  {
    value: "new_build",
    label: "Obra nueva",
    description: "Construcción desde proyecto, sin elementos existentes que desmontar o conservar.",
  },
] as const;

const CONSERVATION_STRATEGIES = [
  { value: "preserve", label: "Conservar al máximo", description: "Reparar antes de sustituir" },
  { value: "balanced", label: "Reforma equilibrada", description: "Conservar lo válido y renovar lo necesario" },
  { value: "replace", label: "Sustitución amplia", description: "Renovar todos los elementos seleccionados" },
] as const;

export function ScopeStep() {
  const { state, updateState, updateSectorData } = useBudgetGenerate();
  const { serviceTypes } = useSector();
  const supabase = createClient();
  const toast = useToast();

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [technicalDocuments, setTechnicalDocuments] = useState<TechnicalDocumentOption[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  // Read scope data from sectorData
  const scopeData = state.sectorData || {};
  const selectedEstancias: string[] = scopeData.estancias || [];
  const selectedActuaciones: string[] = scopeData.actuaciones || [];
  const selectedCalidad: string = scopeData.calidad || "media";
  const superficieM2: number = scopeData.superficie_m2 || 0;
  const numBanos = normalizeBathroomCount(scopeData.num_banos);
  const incluyeCocina: boolean = scopeData.incluye_cocina ?? true;
  const incluyeVentanas: boolean = scopeData.incluye_ventanas ?? false;
  const incluyeClimatizacion: boolean = scopeData.incluye_climatizacion ?? false;
  const ubicacion: string = scopeData.ubicacion || "";
  const selectedTechnicalDocumentIds: string[] = scopeData.technical_document_ids || [];
  const selectedTechnicalDocumentNames: string[] = scopeData.technical_document_names || [];
  const projectContext: "existing_renovation" | "new_build" | "rehabilitation" =
    scopeData.project_context || (/obra[ _-]?nueva/i.test(state.serviceType || "") ? "new_build" : "existing_renovation");
  const existingCondition: "good" | "fair" | "poor" | "unknown" = scopeData.existing_condition || "unknown";
  const conservationStrategy: "preserve" | "balanced" | "replace" = scopeData.conservation_strategy || "balanced";
  const buildingAgeBand: string = scopeData.building_age_band || "unknown";
  const occupiedDuringWorks: boolean = scopeData.occupied_during_works ?? false;
  const geographicProfile = getGeographicCostProfile(ubicacion);

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [clientsRes, projectsRes] = await Promise.all([
        supabase.from("clients").select("id, name, email, phone, company").eq("user_id", user.id).order("name"),
        supabase.from("projects").select("id, name, client_id").eq("user_id", user.id).order("name")
      ]);

      if (clientsRes.data) setClients(clientsRes.data);
      if (projectsRes.data) setProjects(projectsRes.data);
      setLoading(false);
    }
    loadData();
  }, []);

  useEffect(() => {
    if (!state.clientId || clients.length === 0) return;
    const selectedClient = clients.find((client) => client.id === state.clientId);
    if (!selectedClient) return;
    if (
      state.clientName !== selectedClient.name
      || state.clientEmail !== (selectedClient.email || "")
      || state.clientPhone !== (selectedClient.phone || "")
      || state.clientCompany !== (selectedClient.company || "")
    ) {
      updateState({
        clientName: selectedClient.name,
        clientEmail: selectedClient.email || "",
        clientPhone: selectedClient.phone || "",
        clientCompany: selectedClient.company || "",
      });
    }
  }, [clients, state.clientId, state.clientName, state.clientEmail, state.clientPhone, state.clientCompany]);

  useEffect(() => {
    let active = true;

    async function loadTechnicalDocuments() {
      if (!state.projectId) {
        setTechnicalDocuments([]);
        return;
      }

      setLoadingDocuments(true);
      const { data } = await supabase
        .from("project_documents")
        .select("id, name, doc_type, mime_type, file_url, created_at")
        .eq("project_id", state.projectId)
        .order("created_at", { ascending: false });

      if (active) {
        setTechnicalDocuments((data as TechnicalDocumentOption[]) || []);
        setLoadingDocuments(false);
      }
    }

    loadTechnicalDocuments();
    return () => {
      active = false;
    };
  }, [state.projectId]);

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
      if (!user) {
        toast.error("No hay sesión activa", { description: "Vuelve a iniciar sesión e inténtalo de nuevo." });
        return;
      }

      const { data, error } = await supabase.from("projects").insert({
        name: newProjectName.trim(),
        client_id: state.clientId,
        user_id: user.id,
        service_type: state.serviceType || state.sector || "general",
        start_date: state.startDate || null,
      }).select("id, name, client_id").single();

      if (error) {
        console.error("[ScopeStep] create project error:", error);
        toast.error("No se pudo crear la obra", {
          description: `${error.message}${error.code ? ` (code ${error.code})` : ""}`,
        });
        return;
      }

      setProjects(prev => [...prev, data]);
      updateState({ projectId: data.id });
      updateSectorData("technical_document_ids", []);
      updateSectorData("technical_document_names", []);
      setIsCreatingProject(false);
      setNewProjectName("");
    } catch (e: any) {
      console.error(e);
      toast.error("No se pudo crear la obra", { description: e?.message || "Error desconocido" });
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

  const toggleTechnicalDocument = (document: TechnicalDocumentOption) => {
    const selected = selectedTechnicalDocumentIds.includes(document.id);
    const nextIds = selected
      ? selectedTechnicalDocumentIds.filter((id) => id !== document.id)
      : [...selectedTechnicalDocumentIds, document.id];
    const nextNames = selected
      ? selectedTechnicalDocumentNames.filter((name) => name !== document.name)
      : Array.from(new Set([...selectedTechnicalDocumentNames, document.name]));

    updateSectorData("technical_document_ids", nextIds);
    updateSectorData("technical_document_names", nextNames);
  };

  const handleTechnicalDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !state.projectId) return;

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Formato no compatible", {
        description: "Sube un PDF, JPG, PNG o WebP.",
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("El archivo supera 20 MB");
      return;
    }

    setUploadingDocument(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
      const objectPath = `${user.id}/projects/${state.projectId}/technical/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("project-docs")
        .upload(objectPath, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      const { data: created, error: insertError } = await supabase
        .from("project_documents")
        .insert({
          project_id: state.projectId,
          user_id: user.id,
          doc_type: "proyecto_ejecucion",
          name: file.name.replace(/\.[^.]+$/, ""),
          description: "Proyecto de ejecución o mediciones para presupuesto técnico",
          file_url: objectPath,
          file_size: file.size,
          mime_type: file.type,
          tags: ["presupuesto_ia", "arquitecto", "mediciones"],
          analysis_status: "pending",
        })
        .select("id, name, doc_type, mime_type, file_url, created_at")
        .single();

      if (insertError) throw insertError;

      const document = created as TechnicalDocumentOption;
      setTechnicalDocuments((previous) => [document, ...previous]);
      updateSectorData("technical_document_ids", [
        ...selectedTechnicalDocumentIds,
        document.id,
      ]);
      updateSectorData("technical_document_names", Array.from(new Set([
        ...selectedTechnicalDocumentNames,
        document.name,
      ])));
      toast.success("Documento añadido al análisis");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir el documento";
      toast.error("No se pudo añadir el documento", { description: message });
    } finally {
      setUploadingDocument(false);
    }
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
                onChange={(e) => {
                  const clientId = e.target.value;
                  const selectedClient = clients.find((client) => client.id === clientId);
                  updateState({
                    clientId,
                    clientName: selectedClient?.name || "",
                    clientEmail: selectedClient?.email || "",
                    clientPhone: selectedClient?.phone || "",
                    clientCompany: selectedClient?.company || "",
                  });
                }}
                className={inputCls}
                disabled={loading}
              >
                <option value="">Sin asignar</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              {state.clientId && (state.clientEmail || state.clientPhone || state.clientCompany) && (
                <p className="mt-1 text-xs text-navy-500 dark:text-zinc-400">
                  {[state.clientCompany, state.clientEmail, state.clientPhone].filter(Boolean).join(" · ")}
                </p>
              )}
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
                        updateSectorData("technical_document_ids", []);
                        updateSectorData("technical_document_names", []);
                      } else {
                        updateState({ projectId: e.target.value });
                        updateSectorData("technical_document_ids", []);
                        updateSectorData("technical_document_names", []);
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
                onChange={(e) => {
                  const serviceType = e.target.value;
                  updateState({ serviceType });
                  if (/obra[ _-]?nueva/i.test(serviceType)) {
                    updateSectorData("project_context", "new_build");
                  } else if (/rehabilit/i.test(serviceType)) {
                    updateSectorData("project_context", "rehabilitation");
                  } else if (projectContext === "new_build") {
                    updateSectorData("project_context", "existing_renovation");
                  }
                }}
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

      <BudgetTermsFields />

      {isConstruction && (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Ruler className="h-5 w-5 text-brand-green" />
                <h2 className="text-lg font-bold text-navy-900 dark:text-white">
                  Proyecto del arquitecto y mediciones
                </h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-navy-500 dark:text-zinc-400">
                Añade el proyecto de ejecución, planos o mediciones. La IA tomará
                sus superficies y cantidades como fuente principal antes de crear
                las partidas.
              </p>
            </div>

            <label
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                state.projectId && !uploadingDocument
                  ? "cursor-pointer bg-brand-green text-navy-900 hover:bg-brand-green/90"
                  : "cursor-not-allowed bg-navy-100 text-navy-400 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              <UploadCloud className="h-4 w-4" />
              {uploadingDocument ? "Subiendo..." : "Añadir documento"}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={!state.projectId || uploadingDocument}
                onChange={handleTechnicalDocumentUpload}
              />
            </label>
          </div>

          {!state.projectId ? (
            <div className="mt-5 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-300">
              Selecciona o crea una obra para guardar sus planos y mediciones.
            </div>
          ) : loadingDocuments ? (
            <div className="mt-5 h-20 animate-pulse rounded-xl bg-navy-50 dark:bg-zinc-800" />
          ) : technicalDocuments.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-navy-200 bg-navy-50 p-4 text-sm text-navy-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
              Todavía no hay documentos. Puedes continuar introduciendo las
              medidas manualmente o añadir ahora el PDF del arquitecto.
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {technicalDocuments.map((document) => {
                const selected = selectedTechnicalDocumentIds.includes(document.id);
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => toggleTechnicalDocument(document)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-brand-green bg-brand-green/5"
                        : "border-navy-200 bg-white hover:border-brand-green/40 dark:border-zinc-700 dark:bg-zinc-900"
                    }`}
                  >
                    <div className={`rounded-lg p-2 ${selected ? "bg-brand-green/15" : "bg-navy-50 dark:bg-zinc-800"}`}>
                      <FileText className={`h-5 w-5 ${selected ? "text-brand-green" : "text-navy-500 dark:text-zinc-400"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy-900 dark:text-white">
                        {document.name}
                      </p>
                      <p className="text-xs text-navy-500 dark:text-zinc-400">
                        {selected ? "Se utilizará para calcular el presupuesto" : "Pulsa para incluirlo en el análisis"}
                      </p>
                    </div>
                    <span className={`h-5 w-5 rounded-full border text-center text-xs leading-[18px] ${
                      selected
                        ? "border-brand-green bg-brand-green text-navy-900"
                        : "border-navy-300 dark:border-zinc-600"
                    }`}>
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Selector visual de estancias y calidades - V1 */}
      {isConstruction && (
        <Card>
          <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-1">Alcance detallado</h2>
          <p className="text-sm text-navy-500 dark:text-zinc-400 mb-5">
            Selecciona las estancias, actuaciones y calidad. Esto alimenta al análisis IA para generar partidas más precisas.
          </p>

          <div className="mb-6 rounded-xl border border-navy-200 bg-navy-50/70 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <h3 className="text-sm font-bold text-navy-900 dark:text-white">Punto de partida real de la obra</h3>
            <p className="mt-1 text-xs text-navy-500 dark:text-zinc-400">
              Esta selección evita calcular una reforma como si la vivienda se construyera desde cero.
            </p>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {PROJECT_CONTEXTS.map((context) => {
                const active = projectContext === context.value;
                return (
                  <button
                    key={context.value}
                    type="button"
                    onClick={() => updateSectorData("project_context", context.value)}
                    className={`rounded-lg border p-3 text-left transition ${active
                      ? "border-brand-green bg-white shadow-sm dark:bg-zinc-900"
                      : "border-navy-200 bg-white/60 hover:border-brand-green/40 dark:border-zinc-700 dark:bg-zinc-900/40"
                    }`}
                  >
                    <span className={`block text-sm font-bold ${active ? "text-brand-green" : "text-navy-900 dark:text-white"}`}>{context.label}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-navy-500 dark:text-zinc-400">{context.description}</span>
                  </button>
                );
              })}
            </div>

            {projectContext !== "new_build" && (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <label className={labelCls}>Estado actual comprobado</label>
                  <select value={existingCondition} onChange={(event) => updateSectorData("existing_condition", event.target.value)} className={inputCls}>
                    <option value="unknown">Pendiente de visita / inspección</option>
                    <option value="good">Bueno · reparaciones puntuales</option>
                    <option value="fair">Medio · desgaste habitual</option>
                    <option value="poor">Deficiente · patologías o instalaciones antiguas</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Antigüedad aproximada</label>
                  <select value={buildingAgeBand} onChange={(event) => updateSectorData("building_age_band", event.target.value)} className={inputCls}>
                    <option value="unknown">Sin confirmar</option>
                    <option value="pre_1940">Anterior a 1940</option>
                    <option value="1940_1979">1940–1979</option>
                    <option value="1980_2006">1980–2006</option>
                    <option value="post_2006">Posterior a 2006</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className={labelCls}>Criterio de intervención</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {CONSERVATION_STRATEGIES.map((strategy) => {
                      const active = conservationStrategy === strategy.value;
                      return (
                        <button
                          key={strategy.value}
                          type="button"
                          onClick={() => updateSectorData("conservation_strategy", strategy.value)}
                          className={`rounded-lg border px-3 py-2 text-left ${active ? "border-brand-green bg-brand-green/10" : "border-navy-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
                        >
                          <span className="block text-xs font-bold text-navy-900 dark:text-white">{strategy.label}</span>
                          <span className="block text-[10px] text-navy-500 dark:text-zinc-400">{strategy.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-navy-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={occupiedDuringWorks}
                    onChange={(event) => updateSectorData("occupied_during_works", event.target.checked)}
                    className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                  />
                  La vivienda estará ocupada durante la obra
                </label>
              </div>
            )}
          </div>

          {/* Ubicacion y superficie */}
          <div className="mb-6">
            <label className={labelCls}>Ubicación de la obra (ciudad / provincia)</label>
            <input
              type="text"
              value={ubicacion}
              onChange={(e) => updateSectorData("ubicacion", e.target.value)}
              placeholder="Ej: Madrid, Valencia, Barcelona..."
              className={inputCls}
            />
            <p className="text-[11px] text-navy-400 dark:text-zinc-500 mt-1">
              {geographicProfile.label}: {geographicProfile.explanation} Los precios de
              producto procedentes del rastreador no se modifican.
            </p>
          </div>

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
              <label className={labelCls}>Nº de baños afectados</label>
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
                Climatización
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
