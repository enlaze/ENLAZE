"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clipboard, Link as LinkIcon, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Permission = "read" | "approve_changes" | "approve_budgets";

interface PortalTokenMetadata {
  id: string;
  project_id: string;
  permissions: Permission[];
  label: string | null;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  revoked_at: string | null;
  is_live: boolean;
}

interface TokenCursor {
  created_at: string;
  id: string;
}

interface TokenPage {
  items: PortalTokenMetadata[];
  next_cursor: TokenCursor | null;
}

interface IssuedToken extends Omit<PortalTokenMetadata, "is_live"> {
  token: string;
}

interface RevealedLink {
  tokenId: string;
  url: string;
}

const permissionLabels: Record<Permission, string> = {
  read: "Ver el portal",
  approve_changes: "Responder cambios",
  approve_budgets: "Aceptar o rechazar presupuestos",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  if (candidate?.code === "PT409") {
    return candidate.message?.includes("maximum")
      ? "Este proyecto ya tiene cinco enlaces vigentes. Revoca uno antes de crear otro."
      : "El enlace cambió en otra sesión. Actualiza la lista e inténtalo de nuevo.";
  }
  if (candidate?.code === "42501") return "No tienes permiso para gestionar los enlaces de este proyecto.";
  return candidate?.message || "Se produjo un error inesperado.";
}

export default function PortalLinksDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<PortalTokenMetadata[]>([]);
  const [nextCursor, setNextCursor] = useState<TokenCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  const [lifetime, setLifetime] = useState("90");
  const [approveChanges, setApproveChanges] = useState(false);
  const [approveBudgets, setApproveBudgets] = useState(false);
  const [revealed, setRevealed] = useState<RevealedLink | null>(null);

  const loadTokens = useCallback(async (cursor: TokenCursor | null = null) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    const { data, error } = await supabase.rpc("portal_list_tokens", {
      p_project_id: projectId,
      p_limit: 20,
      p_cursor_created_at: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
    });
    if (cursor) setLoadingMore(false);
    else setLoading(false);
    if (error) {
      toast.error("No se pudieron cargar los enlaces", { description: errorMessage(error) });
      return;
    }
    const page = data as TokenPage;
    setTokens((current) => cursor ? [...current, ...(page?.items ?? [])] : (page?.items ?? []));
    setNextCursor(page?.next_cursor ?? null);
  }, [projectId, supabase, toast]);

  useEffect(() => {
    // La carga se inicia después del primer paint. Además de evitar un render
    // en cascada, permite que el diálogo y su foco estén montados antes de que
    // llegue la respuesta de red.
    const timer = window.setTimeout(() => void loadTokens(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTokens]);

  function expiryValue() {
    if (lifetime === "90") return null;
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + Number(lifetime));
    return date.toISOString();
  }

  async function revealAndCopy(issued: IssuedToken, action: "creado" | "renovado") {
    const url = `${window.location.origin}/portal/${issued.token}`;
    setRevealed({ tokenId: issued.id, url });
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Enlace ${action} y copiado`, {
        description: "Guárdalo ahora: el secreto no volverá a mostrarse al cerrar esta ventana.",
      });
    } catch {
      toast.warning(`Enlace ${action}`, {
        description: "No se pudo copiar automáticamente. Usa el botón Copiar antes de cerrar.",
      });
    }
  }

  async function handleIssue() {
    setIssuing(true);
    const permissions: Permission[] = ["read"];
    if (approveChanges) permissions.push("approve_changes");
    if (approveBudgets) permissions.push("approve_budgets");
    const { data, error } = await supabase.rpc("portal_issue_token", {
      p_project_id: projectId,
      p_permissions: permissions,
      p_expires_at: expiryValue(),
      p_label: label.trim() || null,
    });
    setIssuing(false);
    if (error) {
      toast.error("No se pudo crear el enlace", { description: errorMessage(error) });
      return;
    }
    setShowIssueForm(false);
    setLabel("");
    setApproveChanges(false);
    setApproveBudgets(false);
    await revealAndCopy(data as IssuedToken, "creado");
    await loadTokens();
  }

  async function handleRotate(token: PortalTokenMetadata) {
    const ok = await confirm({
      title: "Renovar enlace",
      description: "El enlace actual dejará de funcionar inmediatamente y se creará otro válido durante 90 días.",
      confirmLabel: "Renovar y copiar",
      variant: "danger",
    });
    if (!ok) return;
    setActingId(token.id);
    const { data, error } = await supabase.rpc("portal_rotate_token", {
      p_token_id: token.id,
      p_expires_at: null,
    });
    setActingId(null);
    if (error) {
      toast.error("No se pudo renovar el enlace", { description: errorMessage(error) });
      await loadTokens();
      return;
    }
    const issued = (data as { issued: IssuedToken }).issued;
    await revealAndCopy(issued, "renovado");
    await loadTokens();
  }

  async function handleRevoke(token: PortalTokenMetadata) {
    const ok = await confirm({
      title: "Revocar enlace",
      description: "Quien tenga este enlace perderá el acceso inmediatamente. Esta acción no se puede deshacer.",
      confirmLabel: "Revocar enlace",
      variant: "danger",
    });
    if (!ok) return;
    setActingId(token.id);
    const { error } = await supabase.rpc("portal_revoke_token", { p_token_id: token.id });
    setActingId(null);
    if (error) {
      toast.error("No se pudo revocar el enlace", { description: errorMessage(error) });
      return;
    }
    if (revealed?.tokenId === token.id) setRevealed(null);
    toast.success("Enlace revocado");
    await loadTokens();
  }

  async function copyRevealed() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.url);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar", { description: "Selecciona el enlace y cópialo manualmente." });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      widthClass="max-w-3xl"
      labelledBy="portal-links-title"
      describedBy="portal-links-description"
      dismissable={!issuing && !actingId}
    >
      <div className="max-h-[82vh] overflow-y-auto pr-1">
        <DialogHeader>
          <DialogTitle id="portal-links-title">Enlaces del portal</DialogTitle>
          <DialogDescription id="portal-links-description">
            Gestiona el acceso de clientes a {projectName}. Los secretos solo se muestran al crear o renovar.
          </DialogDescription>
        </DialogHeader>

        {revealed && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-amber-900 dark:text-amber-100">Guarda este enlace ahora</p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Al cerrar esta ventana no podremos volver a mostrar el secreto.
                </p>
                <input
                  readOnly
                  value={revealed.url}
                  aria-label="Enlace recién emitido"
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-navy-900 outline-none focus:border-amber-500 dark:border-amber-800 dark:bg-zinc-950 dark:text-white"
                />
                <Button className="mt-3" size="sm" onClick={copyRevealed}>
                  <Clipboard className="h-4 w-4" /> Copiar enlace
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-navy-900 dark:text-white">Historial de enlaces</p>
            <p className="text-xs text-navy-500 dark:text-zinc-400">Nunca se muestran secretos de enlaces existentes.</p>
          </div>
          <Button size="sm" onClick={() => setShowIssueForm((value) => !value)}>
            <Plus className="h-4 w-4" /> Crear enlace
          </Button>
        </div>

        {showIssueForm && (
          <div className="mb-5 space-y-4 rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 dark:bg-brand-green/10">
            <div>
              <label htmlFor="portal-link-label" className="mb-1 block text-sm font-medium text-navy-800 dark:text-zinc-200">
                Nombre para reconocerlo
              </label>
              <input
                id="portal-link-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={120}
                placeholder="Ej. Cliente principal"
                className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none focus:border-brand-green dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="portal-link-lifetime" className="mb-1 block text-sm font-medium text-navy-800 dark:text-zinc-200">
                Caducidad
              </label>
              <select
                id="portal-link-lifetime"
                value={lifetime}
                onChange={(event) => setLifetime(event.target.value)}
                className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none focus:border-brand-green dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              >
                <option value="30">30 días</option>
                <option value="90">90 días (recomendado)</option>
                <option value="180">180 días</option>
                <option value="360">360 días</option>
              </select>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-navy-800 dark:text-zinc-200">Permisos</legend>
              <label className="flex items-center gap-2 text-sm text-navy-600 dark:text-zinc-300">
                <input type="checkbox" checked disabled /> Ver el portal (obligatorio)
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-navy-600 dark:text-zinc-300">
                <input type="checkbox" checked={approveChanges} onChange={(event) => setApproveChanges(event.target.checked)} />
                Responder cambios
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-navy-600 dark:text-zinc-300">
                <input type="checkbox" checked={approveBudgets} onChange={(event) => setApproveBudgets(event.target.checked)} />
                Aceptar o rechazar presupuestos
              </label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowIssueForm(false)}>Cancelar</Button>
              <Button size="sm" loading={issuing} onClick={handleIssue}>Crear y copiar</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-navy-500 dark:text-zinc-400">Cargando enlaces…</div>
        ) : tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-navy-200 px-4 py-8 text-center dark:border-zinc-700">
            <LinkIcon className="mx-auto h-6 w-6 text-navy-400" />
            <p className="mt-2 text-sm font-medium text-navy-800 dark:text-zinc-200">Todavía no hay enlaces modernos</p>
            <p className="mt-1 text-xs text-navy-500 dark:text-zinc-400">Crea uno para compartir el portal de forma controlada.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => {
              const canAct = token.is_active && !token.revoked_at;
              const state = token.is_live ? "Vigente" : token.revoked_at ? "Revocado" : "Caducado";
              return (
                <div key={token.id} className="rounded-xl border border-navy-100 p-4 dark:border-zinc-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-navy-900 dark:text-white">{token.label || "Enlace sin nombre"}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          token.is_live
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-navy-100 text-navy-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>{state}</span>
                      </div>
                      <p className="mt-1 text-xs text-navy-500 dark:text-zinc-400">
                        Creado {formatDate(token.created_at)} · Caduca {formatDate(token.expires_at)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {token.permissions.map((permission) => (
                          <span key={permission} className="rounded-md bg-navy-50 px-2 py-1 text-[11px] text-navy-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {permissionLabels[permission] ?? permission}
                          </span>
                        ))}
                      </div>
                    </div>
                    {canAct && (
                      <div className="flex shrink-0 gap-2">
                        <Button variant="secondary" size="sm" loading={actingId === token.id} onClick={() => handleRotate(token)}>
                          <RefreshCw className="h-3.5 w-3.5" /> Renovar
                        </Button>
                        <Button variant="danger" size="sm" disabled={actingId === token.id} onClick={() => handleRevoke(token)}>
                          <Trash2 className="h-3.5 w-3.5" /> Revocar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {nextCursor && (
          <div className="mt-4 text-center">
            <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => loadTokens(nextCursor)}>
              Cargar anteriores
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={issuing || Boolean(actingId)}>Cerrar</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
