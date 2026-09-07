"use client";

/**
 * Alta y edición de cliente — el formulario "Nuevo cliente" del rediseño.
 *
 * Las dos piezas que el diseño pedía y no existían:
 *
 *  - EMAIL EN DOS BLOQUES. A la izquierda solo el nombre de usuario, a la
 *    derecha el dominio, con @gmail.com puesto de fábrica, editable a mano y
 *    con desplegable de dominios habituales. Se guarda un email normal en
 *    `clients.email`: la partición es de la interfaz, no del modelo.
 *  - TELÉFONO CON +34 FIJO. El prefijo no se puede borrar sin querer y el
 *    campo solo acepta los 9 dígitos nacionales.
 *
 * Los dos validan en vivo (borde, aro y texto de ayuda cambian mientras
 * escribes) y ninguno bloquea el guardado por sí solo salvo que sea
 * inequívocamente inválido: un email a medias impide guardar, un email vacío
 * no, porque `clients.email` acepta nulos.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import {
  CliCard,
  CliLabel,
  ToneDot,
  Icon,
  ICONS,
  cliBtnPrimary,
  cliBtnSecondary,
  type CliTone,
} from "./ui";
import { CLIENT_STATUSES, clientStatusLabels, type Client } from "@/lib/clients";

/** Los del diseño. El usuario puede escribir cualquier otro. */
const COMMON_DOMAINS = ["gmail.com", "hotmail.com", "outlook.es", "yahoo.es", "icloud.com"];
const DEFAULT_DOMAIN = "gmail.com";

type FieldKind = "idle" | "ok" | "bad";

/* ─── Validación ──────────────────────────────────────────────────────── */

function emailState(local: string, domain: string): { kind: FieldKind; msg: string } {
  const l = local.trim();
  const d = domain.trim().replace(/^@/, "");
  if (!l) return { kind: "idle", msg: `Escribe solo el nombre: el dominio ya es @${d || DEFAULT_DOMAIN}.` };
  if (/[\s@]/.test(l)) return { kind: "bad", msg: "El nombre no puede llevar espacios ni @." };
  if (!d) return { kind: "bad", msg: "Elige un dominio o escribe el tuyo." };
  if (!/^[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(d))
    return { kind: "bad", msg: "Dominio incompleto, p. ej. suempresa.es" };
  return { kind: "ok", msg: `${l}@${d}` };
}

function phoneState(phone: string): { kind: FieldKind; msg: string } {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return { kind: "idle", msg: "Móvil o fijo español, 9 dígitos." };
  if (digits.length < 9)
    return { kind: "idle", msg: `Faltan ${9 - digits.length} dígitos.` };
  if (digits.length > 9) return { kind: "bad", msg: "Un número español tiene 9 dígitos." };
  if (!/^[6789]/.test(digits)) return { kind: "bad", msg: "Debe empezar por 6, 7, 8 o 9." };
  return { kind: "ok", msg: "Número válido · se usará para WhatsApp." };
}

/* ─── Estilos por estado de validación ────────────────────────────────── */

const fieldBase =
  "w-full h-[46px] rounded-xl px-3.5 text-[14.5px] text-navy-900 dark:text-white placeholder:text-navy-400 dark:placeholder:text-zinc-500 border outline-none transition-colors";

function fieldCls(kind: FieldKind): string {
  if (kind === "bad")
    return `${fieldBase} border-danger bg-white dark:bg-zinc-900 ring-4 ring-danger/15`;
  if (kind === "ok")
    return `${fieldBase} border-brand-green bg-white dark:bg-zinc-900 ring-4 ring-brand-green/15`;
  return `${fieldBase} border-navy-200 bg-navy-50 focus:border-brand-green focus:bg-white focus:ring-4 focus:ring-brand-green/15 dark:border-zinc-800 dark:bg-zinc-800/50 dark:focus:bg-zinc-900`;
}

/** El contenedor de los campos partidos (email, teléfono): el borde y el aro
    van fuera y los `input` de dentro son transparentes. */
function boxCls(kind: FieldKind): string {
  const common =
    "flex h-[46px] items-stretch overflow-hidden rounded-xl border transition-colors";
  if (kind === "bad") return `${common} border-danger bg-white dark:bg-zinc-900 ring-4 ring-danger/15`;
  if (kind === "ok")
    return `${common} border-brand-green bg-white dark:bg-zinc-900 ring-4 ring-brand-green/15`;
  return `${common} border-navy-200 bg-navy-50 dark:border-zinc-800 dark:bg-zinc-800/50`;
}

function hintCls(kind: FieldKind): string {
  if (kind === "bad") return "text-[12px] font-semibold text-danger-ink";
  if (kind === "ok") return "text-[12px] font-semibold text-success-ink";
  return "text-[12px] text-navy-400 dark:text-zinc-500";
}

const innerInput =
  "min-w-0 flex-1 bg-transparent px-3.5 text-[14.5px] text-navy-900 outline-none placeholder:text-navy-400 dark:text-white dark:placeholder:text-zinc-500";

const labelCls = "text-[13px] font-semibold text-navy-700 dark:text-zinc-300";

const statusTone: Record<string, CliTone> = {
  active: "success",
  lead: "info",
  inactive: "neutral",
};

/* ─── Reparto del email y el teléfono guardados ───────────────────────── */

function splitEmail(email: string | null): { local: string; domain: string } {
  const at = (email || "").lastIndexOf("@");
  if (at < 0) return { local: (email || "").trim(), domain: DEFAULT_DOMAIN };
  return { local: email!.slice(0, at).trim(), domain: email!.slice(at + 1).trim() || DEFAULT_DOMAIN };
}

/** Los teléfonos guardados vienen en formatos mezclados ("610315998",
    "+34 663946156", "662 123 432"). Se quedan solo los 9 dígitos nacionales:
    el +34 lo pone el prefijo fijo del campo. */
function splitPhone(phone: string | null): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("0034")) digits = digits.slice(4);
  else if (digits.length > 9 && digits.startsWith("34")) digits = digits.slice(2);
  return groupPhone(digits.slice(0, 9));
}

/** "600 000 000" — grupos de tres, como el diseño. */
function groupPhone(digits: string): string {
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export default function ClientForm({
  client,
  suggestedTags,
  onCancel,
  onSaved,
}: {
  /** null → alta. */
  client?: Client | null;
  /** Etiquetas que el usuario ya ha usado en otros clientes. */
  suggestedTags: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();

  const initialEmail = useMemo(() => splitEmail(client?.email ?? null), [client]);

  const [name, setName] = useState(client?.name ?? "");
  const [company, setCompany] = useState(client?.company ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [status, setStatus] = useState(client?.status ?? "lead");
  const [tags, setTags] = useState<string[]>(client?.tags ?? []);
  const [newTag, setNewTag] = useState("");

  const [emailLocal, setEmailLocal] = useState(initialEmail.local);
  const [emailDomain, setEmailDomain] = useState(initialEmail.domain);
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainTouched, setDomainTouched] = useState(false);

  const [phone, setPhone] = useState(splitPhone(client?.phone ?? null));
  const [saving, setSaving] = useState(false);

  const domainRef = useRef<HTMLDivElement>(null);

  /* El desplegable se cierra al pinchar fuera. `mousedown` y no `click` para
     que se adelante al blur del input y no parpadee. */
  useEffect(() => {
    if (!domainOpen) return;
    function onDown(e: MouseEvent) {
      if (!domainRef.current?.contains(e.target as Node)) setDomainOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [domainOpen]);

  const es = emailState(emailLocal, emailDomain);
  const ps = phoneState(phone);
  /* Un campo vacío no impide guardar: email y phone aceptan nulos en la
     tabla. Lo que impide guardar es un valor a medias. */
  const emailBlocks = emailLocal.trim() !== "" && es.kind === "bad";
  const phoneBlocks = phone.trim() !== "" && ps.kind === "bad";
  const canSubmit = name.trim().length > 1 && !emailBlocks && !phoneBlocks && !saving;

  /* Dominios sugeridos: todos, salvo que el usuario esté escribiendo uno
     propio, en cuyo caso se filtra por lo tecleado. */
  const typed = emailDomain.trim().replace(/^@/, "").toLowerCase();
  const domainMatches =
    domainTouched && typed && !COMMON_DOMAINS.includes(typed)
      ? COMMON_DOMAINS.filter((d) => d.startsWith(typed))
      : COMMON_DOMAINS;

  const tagOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...tags, ...suggestedTags]) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }, [tags, suggestedTags]);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag]
    );
  }

  function addNewTag() {
    const t = newTag.trim();
    if (!t) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags((prev) => [...prev, t]);
    setNewTag("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);

    const digits = phone.replace(/\D/g, "");
    const payload = {
      name: name.trim(),
      company: company.trim(),
      notes: notes.trim(),
      status,
      tags,
      email: emailLocal.trim() ? `${emailLocal.trim()}@${emailDomain.trim().replace(/^@/, "")}` : "",
      phone: digits ? `+34 ${groupPhone(digits)}` : "",
    };

    if (client) {
      const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
      setSaving(false);
      if (error) {
        toast.error("No se pudo guardar el cliente");
        return;
      }
      toast.success("Cliente actualizado");
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("clients").insert({ ...payload, user_id: user?.id });
      setSaving(false);
      if (error) {
        toast.error("No se pudo crear el cliente");
        return;
      }
      toast.success("Cliente creado");
    }
    onSaved();
  }

  return (
    <CliCard className="mb-8" padded={false}>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-6 p-6">
          <h2 className="text-lg font-bold tracking-tight text-navy-900 dark:text-white">
            {client ? "Editar cliente" : "Nuevo cliente"}
          </h2>

          {/* ── Nombre · Empresa ── */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>
                Nombre <span className="text-danger-ink">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del cliente"
                required
                className={fieldCls("idle")}
              />
              <span className="text-[12px] text-navy-400 dark:text-zinc-500">
                Aparecerá en presupuestos y facturas.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>
                Empresa <span className="font-normal text-navy-400 dark:text-zinc-500">(opcional)</span>
              </span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Nombre de la empresa"
                className={fieldCls("idle")}
              />
              <span className="text-[12px] text-navy-400 dark:text-zinc-500">
                Comunidad, constructora, particular...
              </span>
            </label>
          </div>

          {/* ── Email partido · Teléfono ── */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>Email</span>
              <div className="relative" ref={domainRef}>
                <div className={boxCls(es.kind)}>
                  <input
                    value={emailLocal}
                    onChange={(e) => setEmailLocal(e.target.value.replace(/@.*$/, "").trim())}
                    placeholder="Nombre de usuario"
                    autoComplete="off"
                    aria-label="Nombre de usuario del email"
                    aria-invalid={es.kind === "bad"}
                    className={innerInput}
                  />
                  <span
                    aria-hidden="true"
                    className="my-2 w-px shrink-0 bg-navy-200 dark:bg-zinc-700"
                  />
                  <div className="flex w-[46%] shrink-0 items-center">
                    <span className="pl-3 text-[14.5px] font-semibold text-navy-400 dark:text-zinc-500">
                      @
                    </span>
                    <input
                      value={emailDomain}
                      onChange={(e) => {
                        setEmailDomain(e.target.value.replace(/^@+/, "").trim());
                        setDomainTouched(true);
                      }}
                      onFocus={() => {
                        setDomainOpen(true);
                        setDomainTouched(false);
                      }}
                      placeholder={DEFAULT_DOMAIN}
                      autoComplete="off"
                      aria-label="Dominio del email"
                      className={`${innerInput} pl-1`}
                    />
                    <button
                      type="button"
                      onClick={() => setDomainOpen((v) => !v)}
                      aria-label="Ver dominios habituales"
                      aria-expanded={domainOpen}
                      className="px-3 text-navy-400 transition-colors hover:text-navy-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    >
                      <Icon path={ICONS.chevron} size={15} />
                    </button>
                  </div>
                </div>

                {domainOpen && domainMatches.length > 0 && (
                  <div className="absolute right-0 top-[52px] z-20 w-[260px] max-w-full overflow-hidden rounded-xl border border-navy-100 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="px-2 py-1.5">
                      <CliLabel>Dominios habituales</CliLabel>
                    </div>
                    {domainMatches.map((d) => {
                      const on = d === emailDomain;
                      return (
                        <button
                          key={d}
                          type="button"
                          /* mousedown y preventDefault: si se esperara al
                             click, el blur del input cerraría antes. */
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            setEmailDomain(d);
                            setDomainOpen(false);
                          }}
                          className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                            on
                              ? "bg-brand-green/12 text-success-ink"
                              : "text-navy-700 hover:bg-navy-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <span className="text-navy-400 dark:text-zinc-500">@</span>
                          <span className="font-medium">{d}</span>
                          {d === DEFAULT_DOMAIN && (
                            <span className="ml-auto rounded border border-navy-200 bg-navy-50 px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wider text-navy-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500">
                              Por defecto
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <div className="border-t border-navy-100 px-2.5 pb-1 pt-2 text-[12px] text-navy-400 dark:border-zinc-800 dark:text-zinc-500">
                      O escribe tu propio dominio
                    </div>
                  </div>
                )}
              </div>
              <span className={hintCls(es.kind)}>{es.msg}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>Teléfono</span>
              <div className={boxCls(ps.kind)}>
                <span className="flex shrink-0 items-center gap-1.5 border-r border-navy-200 px-3.5 text-[14.5px] font-semibold text-navy-600 dark:border-zinc-700 dark:text-zinc-400">
                  <Icon path={ICONS.phone} size={14} />
                  +34
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(groupPhone(e.target.value.replace(/\D/g, "").slice(0, 9)))}
                  placeholder="600 000 000"
                  inputMode="tel"
                  aria-label="Teléfono, sin prefijo"
                  aria-invalid={ps.kind === "bad"}
                  className={innerInput}
                />
              </div>
              <span className={hintCls(ps.kind)}>{ps.msg}</span>
            </div>
          </div>

          {/* ── Estado ── */}
          <div className="flex flex-col gap-2">
            <span className={labelCls}>Estado</span>
            <div className="flex flex-wrap gap-2">
              {CLIENT_STATUSES.map((s) => {
                const on = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={on}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13.5px] font-bold transition-colors ${
                      on
                        ? "border-brand-green bg-brand-green/12 text-success-ink"
                        : "border-navy-200 bg-navy-50 text-navy-600 hover:border-navy-300 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:border-zinc-700"
                    }`}
                  >
                    <ToneDot tone={statusTone[s]} className="h-[7px] w-[7px]" />
                    {clientStatusLabels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Etiquetas ── */}
          <div className="flex flex-col gap-2">
            <span className={labelCls}>Etiquetas</span>
            <div className="flex flex-wrap items-center gap-2">
              {tagOptions.map((t) => {
                const on = tags.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    aria-pressed={on}
                    className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                      on
                        ? "border border-brand-green bg-brand-green/12 text-success-ink"
                        : "border border-dashed border-navy-300 text-navy-500 hover:border-navy-400 hover:text-navy-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
              <span className="flex items-center gap-1.5">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      /* Enter añade la etiqueta; sin esto enviaría el
                         formulario entero. */
                      e.preventDefault();
                      addNewTag();
                    }
                  }}
                  placeholder="Nueva etiqueta"
                  aria-label="Nueva etiqueta"
                  className="h-8 w-[140px] rounded-full border border-dashed border-navy-300 bg-transparent px-3.5 text-[12.5px] text-navy-900 outline-none placeholder:text-navy-400 focus:border-solid focus:border-brand-green dark:border-zinc-700 dark:text-white dark:placeholder:text-zinc-500"
                />
                {newTag.trim() && (
                  <button
                    type="button"
                    onClick={addNewTag}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-navy-200 text-navy-500 transition-colors hover:border-brand-green hover:text-success-ink dark:border-zinc-700 dark:text-zinc-400"
                    aria-label="Añadir etiqueta"
                  >
                    <Icon path={ICONS.plus} size={14} />
                  </button>
                )}
              </span>
            </div>
          </div>

          {/* ── Notas ── */}
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Notas</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Acceso a la obra, persona de contacto, condiciones de pago..."
              className="w-full resize-y rounded-xl border border-navy-200 bg-navy-50 px-3.5 py-3 text-[14.5px] text-navy-900 outline-none transition-colors placeholder:text-navy-400 focus:border-brand-green focus:bg-white focus:ring-4 focus:ring-brand-green/15 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-white dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
            />
          </label>
        </div>

        {/* ── Pie ── */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-navy-100 bg-navy-50/60 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-800/30">
          <span className="mr-auto text-[13px] text-navy-500 dark:text-zinc-400">
            {canSubmit
              ? "Listo para guardar."
              : name.trim().length > 1
                ? "Corrige los campos marcados para continuar."
                : "Añade un nombre para continuar."}
          </span>
          <button type="button" onClick={onCancel} className={cliBtnSecondary}>
            Cancelar
          </button>
          <button type="submit" disabled={!canSubmit} className={cliBtnPrimary}>
            {client ? "Guardar cambios" : "Agregar cliente"}
          </button>
        </div>
      </form>
    </CliCard>
  );
}
