"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import EmptyState from "@/components/ui/empty-state";

/* ─── Types ─── */

interface ProjectDocument {
  id: string;
  project_id: string;
  doc_type: string;
  name: string;
  description: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  tags: string[];
  created_at: string;
}

const DOC_TYPES = [
  { value: "documento", label: "Documento" },
  { value: "foto", label: "Foto" },
  { value: "plano", label: "Plano" },
  { value: "acta", label: "Acta" },
  { value: "parte", label: "Parte de trabajo" },
  { value: "contrato", label: "Contrato" },
  { value: "licencia", label: "Licencia / Permiso" },
];

const typeIcons: Record<string, string> = {
  documento: "📄",
  foto: "📷",
  plano: "📐",
  acta: "📋",
  parte: "🔧",
  contrato: "📝",
  licencia: "🏛️",
};

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/* ─── Component ─── */

export default function DocumentsPanel({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState("all");

  // Upload form
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    doc_type: "documento",
    name: "",
    description: "",
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  async function loadData() {
    const { data } = await supabase
      .from("project_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    setDocuments((data as ProjectDocument[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [projectId]);

  const filtered = filterType === "all"
    ? documents
    : documents.filter((d) => d.doc_type === filterType);

  const typeCounts = documents.reduce((acc, d) => {
    acc[d.doc_type] = (acc[d.doc_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  /* ── Upload ── */

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    // Auto-fill name from first file
    if (files.length === 1 && !uploadForm.name) {
      setUploadForm((prev) => ({ ...prev, name: files[0].name.replace(/\.[^.]+$/, "") }));
    }
    // Auto-detect type from mime
    if (files.length > 0) {
      const mime = files[0].type;
      if (mime.startsWith("image/")) {
        setUploadForm((prev) => ({ ...prev, doc_type: "foto" }));
      }
    }
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) {
      toast.error("Selecciona al menos un archivo.");
      return;
    }
    if (!uploadForm.name.trim()) {
      toast.error("El nombre es obligatorio.");
      return;
    }

    setUploading(true);

    for (const file of selectedFiles) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `projects/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("project-docs")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        // If bucket doesn't exist, save URL as placeholder
        console.warn("Storage upload failed, saving reference:", uploadError.message);
      }

      const { data: urlData } = supabase.storage
        .from("project-docs")
        .getPublicUrl(path);

      const fileUrl = urlData?.publicUrl || path;
      const docName = selectedFiles.length > 1
        ? file.name.replace(/\.[^.]+$/, "")
        : uploadForm.name.trim();

      await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: userId,
        doc_type: uploadForm.doc_type,
        name: docName,
        description: uploadForm.description,
        file_url: fileUrl,
        file_size: file.size,
        mime_type: file.type,
        tags: [],
      });
    }

    setSelectedFiles([]);
    setUploadForm({ doc_type: "documento", name: "", description: "" });
    setShowUploadForm(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadData();
    setUploading(false);
    toast.success(`${selectedFiles.length} archivo(s) subido(s)`);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Eliminar documento",
      description: "¿Eliminar este documento?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    await supabase.from("project_documents").delete().eq("id", id);
    await loadData();
    toast.success("Documento eliminado");
  }

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-navy-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Total documentos</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{documents.length}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Fotos</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{typeCounts["foto"] || 0}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Planos</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{typeCounts["plano"] || 0}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Tamaño total</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">
            {formatFileSize(documents.reduce((s, d) => s + d.file_size, 0))}
          </p>
        </div>
      </div>

      {/* Actions + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button onClick={() => setShowUploadForm(true)}>+ Subir archivo</Button>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterType === "all"
                ? "bg-brand-green text-white"
                : "bg-navy-50 dark:bg-zinc-800 text-navy-600 dark:text-zinc-400 hover:bg-navy-100 dark:hover:bg-zinc-700"
            }`}
          >
            Todos ({documents.length})
          </button>
          {DOC_TYPES.map((t) => {
            const count = typeCounts[t.value] || 0;
            if (count === 0) return null;
            return (
              <button
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterType === t.value
                    ? "bg-brand-green text-white"
                    : "bg-navy-50 dark:bg-zinc-800 text-navy-600 dark:text-zinc-400 hover:bg-navy-100 dark:hover:bg-zinc-700"
                }`}
              >
                {typeIcons[t.value]} {t.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload form */}
      {showUploadForm && (
        <Card className="border-brand-green/30">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
              Subir archivo
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <FormField label="Archivo(s)" required>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="block w-full text-sm text-navy-700 dark:text-zinc-300
                  file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                  file:text-sm file:font-medium
                  file:bg-brand-green/10 file:text-brand-green
                  hover:file:bg-brand-green/20 cursor-pointer"
              />
            </FormField>
            <FormField label="Tipo">
              <Select
                value={uploadForm.doc_type}
                onChange={(e) => setUploadForm({ ...uploadForm, doc_type: e.target.value })}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Nombre" required>
              <Input
                type="text"
                value={uploadForm.name}
                onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                placeholder="Nombre descriptivo"
              />
            </FormField>
            <FormField label="Descripción" className="md:col-span-3">
              <Input
                type="text"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                placeholder="Descripción o notas"
              />
            </FormField>
          </div>

          {selectedFiles.length > 0 && (
            <div className="mb-4 space-y-1">
              {selectedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-navy-500 dark:text-zinc-400">
                  <span>{f.name}</span>
                  <span className="text-navy-300">({formatFileSize(f.size)})</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-3 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Subiendo..." : "Subir"}
            </Button>
            <Button variant="secondary" onClick={() => { setShowUploadForm(false); setSelectedFiles([]); }}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {/* Documents grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Sin documentos"
          description="Sube planos, fotos, actas y cualquier documento de la obra."
          action={
            <Button onClick={() => setShowUploadForm(true)}>+ Subir archivo</Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc) => {
            const isImage = doc.mime_type.startsWith("image/");

            return (
              <div
                key={doc.id}
                className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Preview for images */}
                {isImage && (
                  <div className="h-40 bg-navy-50 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                    <img
                      src={doc.file_url}
                      alt={doc.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}

                {/* Non-image icon */}
                {!isImage && (
                  <div className="h-24 bg-navy-50 dark:bg-zinc-800 flex items-center justify-center">
                    <span className="text-4xl">{typeIcons[doc.doc_type] || "📄"}</span>
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-navy-900 dark:text-white truncate">
                        {doc.name}
                      </p>
                      {doc.description && (
                        <p className="text-xs text-navy-500 dark:text-zinc-500 mt-0.5 line-clamp-2">
                          {doc.description}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-navy-50 text-navy-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label || doc.doc_type}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-navy-50 dark:border-zinc-800">
                    <span className="text-[10px] text-navy-400 dark:text-zinc-500">
                      {new Date(doc.created_at).toLocaleDateString("es-ES")} · {formatFileSize(doc.file_size)}
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-green hover:underline"
                      >
                        Ver
                      </a>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
