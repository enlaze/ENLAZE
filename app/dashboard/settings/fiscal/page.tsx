/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import BackButton from "@/components/ui/back-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import Loading from "@/components/ui/loading";

const ivaRegimes = [
  { value: "general", label: "Régimen General" },
  { value: "simplificado", label: "Régimen Simplificado" },
  { value: "recargo_equivalencia", label: "Recargo de Equivalencia" },
  { value: "exento", label: "Exento de IVA" },
];

const provinces = [
  "Álava", "Albacete", "Alicante", "Almería", "Asturias", "Ávila", "Badajoz", "Barcelona",
  "Burgos", "Cáceres", "Cádiz", "Cantabria", "Castellón", "Ciudad Real", "Córdoba", "Cuenca",
  "Gerona", "Granada", "Guadalajara", "Guipúzcoa", "Huelva", "Huesca", "Islas Baleares",
  "Jaén", "La Coruña", "La Rioja", "Las Palmas", "León", "Lérida", "Lugo", "Madrid",
  "Málaga", "Murcia", "Navarra", "Orense", "Palencia", "Pontevedra", "Salamanca",
  "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria", "Tarragona", "Teruel", "Toledo",
  "Valencia", "Valladolid", "Vizcaya", "Zamora", "Zaragoza",
];

interface FiscalForm {
  business_name: string; trade_name: string; nif: string;
  address: string; city: string; postal_code: string; province: string;
  email: string; phone: string;
  iva_regime: string; default_iva_percent: number; default_irpf_percent: number;
  invoice_series: string; invoice_next_number: number; verifactu_enabled: boolean;
}

const emptyForm: FiscalForm = {
  business_name: "", trade_name: "", nif: "",
  address: "", city: "", postal_code: "", province: "Madrid",
  email: "", phone: "",
  iva_regime: "general", default_iva_percent: 21, default_irpf_percent: 0,
  invoice_series: "F", invoice_next_number: 1, verifactu_enabled: true,
};

export default function FiscalSettingsPage() {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FiscalForm>(emptyForm);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const { data } = await supabase.from("fiscal_settings").select("*").eq("user_id", user.id).single();
    if (data) {
      setExistingId(data.id);
      setForm({
        business_name: data.business_name || "",
        trade_name: data.trade_name || "",
        nif: data.nif || "",
        address: data.address || "",
        city: data.city || "",
        postal_code: data.postal_code || "",
        province: data.province || "Madrid",
        email: data.email || "",
        phone: data.phone || "",
        iva_regime: data.iva_regime || "general",
        default_iva_percent: data.default_iva_percent ?? 21,
        default_irpf_percent: data.default_irpf_percent ?? 0,
        invoice_series: data.invoice_series || "F",
        invoice_next_number: data.invoice_next_number ?? 1,
        verifactu_enabled: data.verifactu_enabled ?? true,
      });
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!userId) return;
    if (!form.business_name.trim()) {
      toast.error("La razón social es obligatoria");
      return;
    }
    if (!form.nif.trim()) {
      toast.error("El NIF/CIF es obligatorio");
      return;
    }
    setSaving(true);

    const payload = {
      user_id: userId,
      ...form,
      business_name: form.business_name.trim(),
      nif: form.nif.trim().toUpperCase(),
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      const { error } = await supabase.from("fiscal_settings").update(payload).eq("id", existingId);
      if (error) toast.error("Error guardando", { description: error.message });
      else {
        toast.success("Datos fiscales actualizados");
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } else {
      const { data, error } = await supabase.from("fiscal_settings").insert(payload).select("id").single();
      if (error) toast.error("Error guardando", { description: error.message });
      else {
        setExistingId(data.id);
        toast.success("Datos fiscales guardados");
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    }
    setSaving(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <BackButton fallbackHref="/dashboard/settings" label="Volver a Ajustes" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Ajustes Fiscales</h1>
        <p className="text-sm text-navy-500 dark:text-zinc-400">Datos del emisor para facturas emitidas, Verifactu y Facturae</p>
      </div>

      {/* Datos de la empresa */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Datos de la empresa / autónomo</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Razón social" required className="md:col-span-2">
            <Input type="text" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} placeholder="Ej: Reformas López S.L." />
          </FormField>
          <FormField label="Nombre comercial">
            <Input type="text" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} placeholder="Ej: Reformas López" />
          </FormField>
          <FormField label="NIF / CIF" required>
            <Input type="text" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder="B12345678" />
          </FormField>
          <FormField label="Dirección fiscal" className="md:col-span-2">
            <Input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle, número, piso" />
          </FormField>
          <FormField label="Ciudad">
            <Input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Madrid" />
          </FormField>
          <FormField label="Código postal">
            <Input type="text" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} placeholder="28001" />
          </FormField>
          <FormField label="Provincia">
            <Select value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
              {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </FormField>
          <FormField label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="facturacion@empresa.com" />
          </FormField>
          <FormField label="Teléfono">
            <Input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 000 000" />
          </FormField>
        </div>
      </Card>

      {/* Configuración fiscal */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Configuración fiscal</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Régimen de IVA">
            <Select value={form.iva_regime} onChange={(e) => setForm({ ...form, iva_regime: e.target.value })}>
              {ivaRegimes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </FormField>
          <FormField label="IVA por defecto (%)">
            <Input type="number" step="0.01" value={form.default_iva_percent} onChange={(e) => setForm({ ...form, default_iva_percent: parseFloat(e.target.value) || 0 })} />
          </FormField>
          <FormField label="IRPF por defecto (%)" hint="0 si no aplica retención">
            <Input type="number" step="0.01" value={form.default_irpf_percent} onChange={(e) => setForm({ ...form, default_irpf_percent: parseFloat(e.target.value) || 0 })} />
          </FormField>
        </div>
      </Card>

      {/* Series de facturación */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Numeración de facturas</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Serie">
            <Input type="text" value={form.invoice_series} onChange={(e) => setForm({ ...form, invoice_series: e.target.value.toUpperCase() })} placeholder="F" />
          </FormField>
          <FormField label="Próximo número">
            <Input type="number" value={form.invoice_next_number} onChange={(e) => setForm({ ...form, invoice_next_number: parseInt(e.target.value) || 1 })} />
          </FormField>
          <div className="flex items-end">
            <p className="text-sm text-navy-700 bg-navy-50 dark:bg-zinc-900 dark:text-zinc-300 border border-navy-100 dark:border-zinc-800 rounded-lg px-4 py-2 w-full text-center font-mono">
              {form.invoice_series}-{new Date().getFullYear()}/{String(form.invoice_next_number).padStart(4, "0")}
            </p>
          </div>
        </div>
      </Card>

      {/* Verifactu */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">Verifactu</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.verifactu_enabled} onChange={(e) => setForm({ ...form, verifactu_enabled: e.target.checked })}
            className="w-5 h-5 rounded border-navy-200 dark:border-zinc-700 text-brand-green focus:ring-brand-green" />
          <div>
            <span className="text-sm text-navy-900 dark:text-white">Activar Verifactu</span>
            <p className="text-xs text-navy-500 dark:text-zinc-400">Genera hash SHA-256 encadenado y código QR en cada factura emitida. Obligatorio desde julio 2025.</p>
          </div>
        </label>
      </Card>

      {/* Save */}
      <div className="flex justify-end gap-3 items-center">
        {saved && <span className="text-sm text-brand-green flex items-center">✓ Guardado correctamente</span>}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar ajustes fiscales"}
        </Button>
      </div>
    </div>
  );
}
