"use client";

/**
 * Ajustes → Empresa y datos fiscales.
 *
 * Unifica lo que antes vivía en /settings/fiscal y /settings/sector, más los
 * campos de ubicación nuevos (provincia + comunidad autónoma).
 *
 * Persistencia (sin cambios respecto a lo que ya había, solo ampliada):
 *  - `fiscal_settings`  → identidad, domicilio, fiscalidad, numeración, Verifactu.
 *  - `profiles`         → business_name, business_sector y la UBICACIÓN que lee
 *                         el agente económico (city, province, comunidad_autonoma).
 *  - `fiscal_settings.sector_key` se mantiene sincronizado con el mapeo grueso,
 *    igual que hacía la antigua pantalla de sector.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import { useSector } from "@/lib/sector-context";
import { normalizeSectorId } from "@/lib/sectors";
import { SECTOR_GROUPS, groupForSector, subsectorsForGroup } from "@/lib/sector-groups";
import { ES_PROVINCES, ES_COMUNIDADES, comunidadForProvince } from "@/lib/es-regions";
import Loading from "@/components/ui/loading";
import {
  CARD,
  DirtyIndicator,
  Field,
  FieldGrid,
  HINT,
  IcoCheck,
  IcoLock,
  IcoPin,
  PILL,
  PanelHeader,
  SaveBar,
  SelectInput,
  SplitSection,
  Switch,
  TextInput,
  ToggleRow,
} from "@/components/settings/ui";

const LOGO_BUCKET = "company-branding";
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // límite del bucket
const LOGO_MIME = ["image/png", "image/jpeg", "image/webp"];

const IVA_REGIMES = [
  { value: "general", label: "Régimen general" },
  { value: "simplificado", label: "Régimen simplificado" },
  { value: "recargo_equivalencia", label: "Recargo de equivalencia" },
  { value: "exento", label: "Exento (art. 20 LIVA)" },
];

/**
 * Mapea el subsector granular al `sector_key` grueso que usan el banco de
 * precios y el layout de módulos. Copiado tal cual de la antigua
 * /settings/sector para no alterar el comportamiento.
 */
function coarseSectorKey(granular: string): string {
  switch (granular) {
    case "construccion":
      return "construccion";
    case "comercio":
      return "comercio";
    default:
      return "servicios";
  }
}

interface EmpresaForm {
  // fiscal_settings
  business_name: string;
  trade_name: string;
  nif: string;
  address: string;
  city: string;
  postal_code: string;
  province: string;
  comunidad_autonoma: string;
  email: string;
  phone: string;
  iva_regime: string;
  default_iva_percent: number;
  default_irpf_percent: number;
  invoice_series: string;
  invoice_next_number: number;
  verifactu_enabled: boolean;
  facturae_enabled: boolean;
  cnae: string;
  logo_url: string;
  // profiles
  business_sector: string;
}

const EMPTY_FORM: EmpresaForm = {
  business_name: "",
  trade_name: "",
  nif: "",
  address: "",
  city: "",
  postal_code: "",
  province: "Madrid",
  comunidad_autonoma: "Comunidad de Madrid",
  email: "",
  phone: "",
  iva_regime: "general",
  default_iva_percent: 21,
  default_irpf_percent: 0,
  invoice_series: "F",
  invoice_next_number: 1,
  verifactu_enabled: true,
  facturae_enabled: false,
  cnae: "",
  logo_url: "",
  business_sector: "otro",
};

/** Campos que alimentan el briefing del agente y la facturación. */
const COMPLETION_FIELDS: (keyof EmpresaForm)[] = [
  "business_name",
  "trade_name",
  "nif",
  "address",
  "postal_code",
  "city",
  "province",
  "comunidad_autonoma",
  "email",
  "phone",
  "invoice_series",
];

export function completionPercent(form: EmpresaForm, sectorSet: boolean): number {
  const filled = COMPLETION_FIELDS.filter((key) => String(form[key] ?? "").trim() !== "").length;
  const total = COMPLETION_FIELDS.length + 1; // +1 = sector elegido
  return Math.round(((filled + (sectorSet ? 1 : 0)) / total) * 100);
}

export default function EmpresaPanel({
  onCompletionChange,
}: {
  onCompletionChange?: (percent: number) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { reload: reloadSector } = useSector();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [existingFiscalId, setExistingFiscalId] = useState<string | null>(null);
  const [form, setForm] = useState<EmpresaForm>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<EmpresaForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

  /* ── Validación (misma exigencia que la pantalla anterior + formato) ── */
  const nifOk = /^([a-z]\d{7}[a-z0-9]|\d{8}[a-z])$/i.test(form.nif.trim());
  const cpOk = form.postal_code.trim() === "" || /^\d{5}$/.test(form.postal_code.trim());
  const serieOk = /^[a-z0-9][a-z0-9-]{1,11}$/i.test(form.invoice_series.trim());
  const razonOk = form.business_name.trim() !== "";
  const canSave = nifOk && cpOk && serieOk && razonOk;

  const patch = useCallback((next: Partial<EmpresaForm>) => {
    setForm((prev) => ({ ...prev, ...next }));
    setJustSaved(false);
  }, []);

  /** La provincia arrastra la comunidad autónoma, pero esta sigue siendo editable. */
  const onProvinceChange = useCallback(
    (province: string) => {
      const deduced = comunidadForProvince(province);
      patch({ province, ...(deduced ? { comunidad_autonoma: deduced } : {}) });
    },
    [patch],
  );

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setUserId(user.id);

    const [{ data: fiscal }, { data: profile }] = await Promise.all([
      supabase.from("fiscal_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("profiles")
        .select("business_sector, business_name, city, province, comunidad_autonoma, logo_url")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    const province = fiscal?.province || profile?.province || EMPTY_FORM.province;
    const city = fiscal?.city || profile?.city || "";

    const loaded: EmpresaForm = {
      business_name: fiscal?.business_name || profile?.business_name || "",
      trade_name: fiscal?.trade_name || "",
      nif: fiscal?.nif || "",
      address: fiscal?.address || "",
      city,
      postal_code: fiscal?.postal_code || "",
      province,
      comunidad_autonoma:
        fiscal?.comunidad_autonoma || profile?.comunidad_autonoma || comunidadForProvince(province),
      email: fiscal?.email || user.email || "",
      phone: fiscal?.phone || "",
      iva_regime: fiscal?.iva_regime || "general",
      default_iva_percent: fiscal?.default_iva_percent ?? 21,
      default_irpf_percent: fiscal?.default_irpf_percent ?? 0,
      invoice_series: fiscal?.invoice_series || "F",
      invoice_next_number: fiscal?.invoice_next_number ?? 1,
      verifactu_enabled: fiscal?.verifactu_enabled ?? true,
      facturae_enabled: fiscal?.facturae_enabled ?? false,
      cnae: fiscal?.cnae || "",
      logo_url: fiscal?.logo_url || profile?.logo_url || "",
      business_sector: normalizeSectorId(profile?.business_sector),
    };

    if (fiscal?.id) setExistingFiscalId(fiscal.id);
    setForm(loaded);
    setBaseline(loaded);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    // Carga inicial desde Supabase: el setState va dentro de `load`, tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    onCompletionChange?.(completionPercent(form, form.business_sector !== "otro"));
  }, [form, onCompletionChange]);

  /* ── Guardado ─────────────────────────────────────────────────────── */

  async function handleSave() {
    if (!userId || !canSave) return;
    setSaving(true);

    const nif = form.nif.trim().toUpperCase();
    const province = form.province.trim();
    const comunidad = form.comunidad_autonoma.trim();
    const city = form.city.trim();

    const fiscalPayload = {
      user_id: userId,
      business_name: form.business_name.trim(),
      trade_name: form.trade_name.trim(),
      nif,
      address: form.address.trim(),
      city,
      postal_code: form.postal_code.trim(),
      province,
      comunidad_autonoma: comunidad,
      email: form.email.trim(),
      phone: form.phone.trim(),
      iva_regime: form.iva_regime,
      default_iva_percent: form.default_iva_percent,
      default_irpf_percent: form.default_irpf_percent,
      invoice_series: form.invoice_series.trim().toUpperCase(),
      invoice_next_number: form.invoice_next_number,
      verifactu_enabled: form.verifactu_enabled,
      facturae_enabled: form.facturae_enabled,
      cnae: form.cnae.trim(),
      logo_url: form.logo_url || null,
      sector_key: coarseSectorKey(form.business_sector),
      updated_at: new Date().toISOString(),
    };

    if (existingFiscalId) {
      const { error } = await supabase
        .from("fiscal_settings")
        .update(fiscalPayload)
        .eq("id", existingFiscalId);
      if (error) {
        toast.error("Error guardando", { description: error.message });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("fiscal_settings")
        .insert(fiscalPayload)
        .select("id")
        .single();
      if (error) {
        toast.error("Error guardando", { description: error.message });
        setSaving(false);
        return;
      }
      setExistingFiscalId(data.id);
    }

    // Espejo en `profiles`: es de donde lee el agente económico.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        business_name: fiscalPayload.business_name,
        business_sector: form.business_sector,
        city,
        province,
        comunidad_autonoma: comunidad,
        logo_url: form.logo_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      toast.error("Datos fiscales guardados, pero el perfil del agente falló", {
        description: profileError.message,
      });
      setSaving(false);
      return;
    }

    // El resto de la app (terminología, módulos visibles) relee el sector.
    if (baseline.business_sector !== form.business_sector) {
      await reloadSector();
    }

    setBaseline(form);
    setSaving(false);
    setJustSaved(true);
    toast.success("Datos de empresa actualizados");
  }

  function handleDiscard() {
    setForm(baseline);
    setJustSaved(false);
  }

  /* ── Logotipo ─────────────────────────────────────────────────────── */

  async function handleLogoFile(file: File) {
    if (!userId) return;
    if (!LOGO_MIME.includes(file.type)) {
      toast.error("Formato no admitido", { description: "Sube un PNG, JPG o WEBP." });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("La imagen pesa demasiado", { description: "El máximo son 2 MB." });
      return;
    }

    setUploadingLogo(true);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    // Ruta con prefijo `${userId}/` — así el borrado de cuenta la encuentra.
    const path = `${userId}/logo.${ext}`;

    const { error } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) {
      toast.error("No se pudo subir el logotipo", { description: error.message });
      setUploadingLogo(false);
      return;
    }

    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    // `?v=` evita que el navegador siga sirviendo el logo anterior cacheado.
    patch({ logo_url: `${data.publicUrl}?v=${Date.now()}` });
    setUploadingLogo(false);
  }

  if (loading) return <Loading />;

  const group = groupForSector(form.business_sector);
  const subsectors = subsectorsForGroup(group.id);
  const initials =
    (form.trade_name || form.business_name || "EN")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "EN";

  return (
    <div>
      <PanelHeader
        title="Empresa y datos fiscales"
        description="La identidad de tu negocio en Enlaze. Estos datos aparecen en tus facturas y presupuestos, y definen la zona que vigila tu agente económico."
        pill="Personaliza tu briefing y tus facturas"
      >
        <DirtyIndicator dirty={dirty} justSaved={justSaved} />
      </PanelHeader>

      <div style={{ ...CARD, marginTop: 34 }}>
        {/* ── Identidad ── */}
        <SplitSection
          first
          title="Identidad"
          description="Cómo te conocen tus clientes y cómo te identifica Hacienda."
        >
          <FieldGrid>
            <Field
              full
              label="Nombre comercial"
              hint="El nombre con el que te presentas. Aparece en la cabecera de presupuestos."
            >
              <TextInput
                value={form.trade_name}
                onChange={(v) => patch({ trade_name: v })}
                placeholder="Reformas López"
              />
            </Field>

            <Field
              label="Razón social"
              hint="Denominación legal registrada, tal cual figura en escrituras."
              error={razonOk ? undefined : "La razón social es obligatoria."}
            >
              <TextInput
                value={form.business_name}
                onChange={(v) => patch({ business_name: v })}
                placeholder="Reformas López S.L."
                invalid={!razonOk}
              />
            </Field>

            <Field
              label="NIF / CIF"
              error={nifOk ? undefined : "Formato no válido. Ej.: B98765432 o 12345678Z"}
            >
              <TextInput
                value={form.nif}
                onChange={(v) => patch({ nif: v.toUpperCase() })}
                placeholder="B12345678"
                invalid={!nifOk}
              />
              {nifOk && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    color: "var(--st-accent-ink)",
                    fontWeight: 600,
                  }}
                >
                  <IcoCheck />
                  Formato válido
                </span>
              )}
            </Field>

            <Field label="Email de facturación" hint="Aparece en facturas y presupuestos.">
              <TextInput
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(v) => patch({ email: v })}
                placeholder="facturacion@empresa.com"
              />
            </Field>

            <Field label="Teléfono">
              <TextInput
                inputMode="tel"
                value={form.phone}
                onChange={(v) => patch({ phone: v })}
                placeholder="600 000 000"
              />
            </Field>

            {/* Logotipo */}
            <div
              style={{
                gridColumn: "1/-1",
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "18px 20px",
                border: "1px solid var(--st-border)",
                borderRadius: 14,
                background: "var(--st-panel-2)",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  flex: "none",
                  borderRadius: 14,
                  background: form.logo_url ? "var(--st-field)" : "#0d2a2c",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  overflow: "hidden",
                  border: form.logo_url ? "1px solid var(--st-border)" : "none",
                }}
              >
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logo_url}
                    alt="Logotipo de tu empresa"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  initials
                )}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--st-text)" }}>Logotipo</div>
                <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--st-muted)" }}>
                  Se imprime en facturas y presupuestos. PNG, JPG o WEBP, fondo transparente, máximo 2 MB.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "none" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={LOGO_MIME.join(",")}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingLogo}
                  data-st-hover="subtle"
                  style={{
                    height: 38,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px solid var(--st-border-strong)",
                    background: "var(--st-field)",
                    color: "var(--st-text)",
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: uploadingLogo ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {uploadingLogo ? "Subiendo…" : "Subir imagen"}
                </button>
                {form.logo_url && (
                  <button
                    type="button"
                    onClick={() => patch({ logo_url: "" })}
                    style={{
                      height: 38,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      background: "transparent",
                      color: "var(--st-muted)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>
          </FieldGrid>
        </SplitSection>

        {/* ── Ubicación (clave para el agente) ── */}
        <SplitSection
          alt
          badge="CLAVE PARA TU AGENTE"
          title="Ubicación"
          description="Tu agente económico usa provincia y comunidad autónoma para filtrar noticias, ayudas y subvenciones que te afectan de verdad."
          aside={
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 12,
                border: "1px solid var(--st-border)",
                background: "var(--st-panel)",
              }}
            >
              <div
                style={{ fontSize: 11.5, fontWeight: 700, color: "var(--st-muted)", letterSpacing: ".06em" }}
              >
                ZONA VIGILADA
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span
                  style={{
                    padding: "5px 10px",
                    borderRadius: 8,
                    background: "var(--st-accent-soft)",
                    color: "var(--st-accent-ink)",
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                >
                  {form.comunidad_autonoma || "Sin comunidad"}
                </span>
                <span
                  style={{
                    padding: "5px 10px",
                    borderRadius: 8,
                    background: "var(--st-field-alt)",
                    color: "var(--st-text-2)",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {form.province || "Sin provincia"}
                </span>
                {form.city.trim() && (
                  <span
                    style={{
                      padding: "5px 10px",
                      borderRadius: 8,
                      background: "var(--st-field-alt)",
                      color: "var(--st-text-2)",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    {form.city}
                  </span>
                )}
              </div>
            </div>
          }
        >
          <FieldGrid>
            <Field full label="Dirección" hint="Domicilio fiscal que se imprime en cada factura.">
              <TextInput
                value={form.address}
                onChange={(v) => patch({ address: v })}
                placeholder="Calle, número, piso"
              />
            </Field>

            <Field
              label="Código postal"
              error={cpOk ? undefined : "Deben ser 5 dígitos."}
            >
              <TextInput
                value={form.postal_code}
                onChange={(v) => patch({ postal_code: v.replace(/\D/g, "") })}
                placeholder="28001"
                inputMode="numeric"
                maxLength={5}
                invalid={!cpOk}
              />
            </Field>

            <Field label="Ciudad" hint="La usa el agente para las noticias más locales.">
              <TextInput value={form.city} onChange={(v) => patch({ city: v })} placeholder="Madrid" />
            </Field>

            <Field label="Provincia" hint="Determina las ayudas provinciales que te avisamos.">
              <SelectInput value={form.province} onChange={onProvinceChange}>
                {ES_PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field
              label="Comunidad autónoma"
              hint="Se deduce de la provincia. Puedes cambiarla si operas en otra."
              suffix={<span style={PILL}>AUTOCOMPLETADO</span>}
            >
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 14,
                    top: 14,
                    pointerEvents: "none",
                    lineHeight: 0,
                    zIndex: 1,
                  }}
                >
                  <IcoPin stroke="var(--st-accent)" />
                </span>
                <select
                  value={form.comunidad_autonoma}
                  onChange={(e) => patch({ comunidad_autonoma: e.target.value })}
                  style={{
                    width: "100%",
                    height: 44,
                    padding: "0 38px 0 39px",
                    border: "1px dashed var(--st-border-strong)",
                    borderRadius: 11,
                    background: "var(--st-field-alt)",
                    color: "var(--st-text)",
                    fontSize: 14.5,
                    fontWeight: 600,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {form.comunidad_autonoma === "" && <option value="">Sin especificar</option>}
                  {ES_COMUNIDADES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </FieldGrid>
        </SplitSection>

        {/* ── Fiscalidad y facturación ── */}
        <SplitSection
          title="Fiscalidad y facturación"
          description="Cómo calculamos impuestos y numeramos tus facturas. Cámbialo solo si tu asesoría lo indica."
        >
          <FieldGrid>
            <Field label="Régimen de IVA" hint="Se aplica por defecto a cada línea de factura.">
              <SelectInput value={form.iva_regime} onChange={(v) => patch({ iva_regime: v })}>
                {IVA_REGIMES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="IVA por defecto" hint="Porcentaje aplicado a cada línea nueva.">
              <SuffixedNumberInput
                value={form.default_iva_percent}
                onChange={(v) => patch({ default_iva_percent: v })}
                suffix="%"
              />
            </Field>

            <Field label="Retención IRPF" hint="Habitual: 15% en actividades profesionales.">
              <SuffixedNumberInput
                value={form.default_irpf_percent}
                onChange={(v) => patch({ default_irpf_percent: v })}
                suffix="%"
              />
            </Field>

            <Field
              label="Serie de factura"
              hint="Prefijo de numeración. Debe ser correlativo por año."
              error={serieOk ? undefined : "Solo letras, números y guiones (2–12 caracteres)."}
            >
              <TextInput
                value={form.invoice_series}
                onChange={(v) => patch({ invoice_series: v.toUpperCase() })}
                placeholder="F"
                invalid={!serieOk}
              />
            </Field>

            <Field label="Próximo número">
              <TextInput
                value={String(form.invoice_next_number)}
                onChange={(v) => patch({ invoice_next_number: parseInt(v.replace(/\D/g, ""), 10) || 1 })}
                inputMode="numeric"
              />
              <span style={HINT}>
                Siguiente factura:{" "}
                <strong style={{ color: "var(--st-text)" }}>
                  {form.invoice_series || "F"}-{new Date().getFullYear()}/
                  {String(form.invoice_next_number).padStart(4, "0")}
                </strong>
              </span>
            </Field>

            <ToggleRow
              boxed
              title="Verifactu"
              badge="OBLIGATORIO 2026"
              description="Genera el hash SHA-256 encadenado y el QR verificable en cada factura emitida, y conserva el registro por ti."
            >
              <Switch
                checked={form.verifactu_enabled}
                onChange={(v) => patch({ verifactu_enabled: v })}
                label="Activar Verifactu"
              />
            </ToggleRow>

            <ToggleRow
              boxed
              title="Facturación electrónica B2B"
              description="Emite en formato Facturae firmado para clientes que lo exigen (administraciones y grandes cuentas)."
            >
              <Switch
                checked={form.facturae_enabled}
                onChange={(v) => patch({ facturae_enabled: v })}
                label="Activar facturación electrónica B2B"
              />
            </ToggleRow>
          </FieldGrid>
        </SplitSection>

        {/* ── Sector y actividad ── */}
        <SplitSection
          alt
          title="Sector y actividad"
          description="Adapta el vocabulario del producto, las plantillas de presupuesto y las fuentes que lee tu agente."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <FieldGrid>
              <Field label="Sector">
                <SelectInput
                  value={group.id}
                  onChange={(groupId) => {
                    const first = subsectorsForGroup(groupId)[0];
                    if (first) patch({ business_sector: first.id });
                  }}
                >
                  {SECTOR_GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field label="CNAE (opcional)" hint="Código de actividad de tu alta censal.">
                <TextInput
                  value={form.cnae}
                  onChange={(v) => patch({ cnae: v })}
                  placeholder="4332 — Instalación de carpintería"
                />
              </Field>
            </FieldGrid>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--st-text)" }}>Subsector</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {subsectors.map((s) => {
                  const active = form.business_sector === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => patch({ business_sector: s.id })}
                      title={s.desc}
                      style={{
                        padding: "9px 14px",
                        borderRadius: 10,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 13.5,
                        fontWeight: active ? 700 : 600,
                        color: active ? "var(--st-accent-ink)" : "var(--st-text-2)",
                        background: active ? "var(--st-accent-soft)" : "var(--st-field)",
                        border: `1px solid ${active ? "var(--st-accent)" : "var(--st-border-strong)"}`,
                      }}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <span style={HINT}>
                Elige el que más se parezca a tu día a día. Puedes cambiarlo cuando quieras.
              </span>
              {baseline.business_sector !== form.business_sector && (
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--st-accent-ink)",
                    lineHeight: 1.55,
                  }}
                >
                  Al cambiar de sector, el agente diario usará otra persona experta, otras noticias y otros
                  KPIs. Tus datos existentes no se eliminarán.
                </span>
              )}
            </div>
          </div>
        </SplitSection>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 20,
          fontSize: 12.5,
          color: "var(--st-muted)",
        }}
      >
        <IcoLock size={14} />
        Datos cifrados y usados solo para tus facturas y tu briefing. Nunca se comparten con terceros.
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        canSave={canSave}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  );
}

/** Input numérico con sufijo pegado a la derecha (el "%" del diseño). */
function SuffixedNumberInput({
  value,
  onChange,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 44,
        border: "1px solid var(--st-border-strong)",
        borderRadius: 11,
        background: "var(--st-field)",
        overflow: "hidden",
      }}
    >
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          padding: "0 14px",
          border: "none",
          background: "transparent",
          color: "var(--st-text)",
          fontSize: 14.5,
          fontWeight: 600,
          outline: "none",
        }}
      />
      <span
        style={{
          padding: "0 14px",
          height: "100%",
          display: "grid",
          placeItems: "center",
          fontSize: 13.5,
          fontWeight: 700,
          color: "var(--st-muted)",
          background: "var(--st-field-alt)",
          borderLeft: "1px solid var(--st-border)",
        }}
      >
        {suffix}
      </span>
    </div>
  );
}
