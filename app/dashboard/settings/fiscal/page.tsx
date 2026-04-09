"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const inputCls = "w-full bg-[var(--color-navy-700)] text-[var(--color-navy-50)] rounded-lg px-4 py-2 border border-[var(--color-navy-600)] focus:border-[var(--color-brand-green)] focus:outline-none text-sm";

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
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FiscalForm>(emptyForm);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { load(); }, []);

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
    if (!form.business_name.trim()) { alert("La razón social es obligatoria."); return; }
    if (!form.nif.trim()) { alert("El NIF/CIF es obligatorio."); return; }
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
      if (error) alert("Error: " + error.message);
      else { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } else {
      const { data, error } = await supabase.from("fiscal_settings").insert(payload).select("id").single();
      if (error) alert("Error: " + error.message);
      else { setExistingId(data.id); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Ajustes Fiscales</h1>
        <p className="text-sm text-[var(--color-navy-400)]">Datos del emisor para facturas emitidas, Verifactu y Facturae</p>
      </div>

      {/* Datos de la empresa */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Datos de la empresa / autónomo</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Razón social *</label>
            <input type="text" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} className={inputCls} placeholder="Ej: Reformas López S.L." />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Nombre comercial</label>
            <input type="text" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} className={inputCls} placeholder="Ej: Reformas López" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">NIF / CIF *</label>
            <input type="text" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} className={inputCls} placeholder="B12345678" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Dirección fiscal</label>
            <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} placeholder="Calle, número, piso" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Ciudad</label>
            <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} placeholder="Madrid" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Código postal</label>
            <input type="text" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} className={inputCls} placeholder="28001" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Provincia</label>
            <select value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} className={inputCls}>
              {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="facturacion@empresa.com" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Teléfono</label>
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="600 000 000" />
          </div>
        </div>
      </div>

      {/* Configuración fiscal */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Configuración fiscal</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Régimen de IVA</label>
            <select value={form.iva_regime} onChange={(e) => setForm({ ...form, iva_regime: e.target.value })} className={inputCls}>
              {ivaRegimes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">IVA por defecto (%)</label>
            <input type="number" step="0.01" value={form.default_iva_percent} onChange={(e) => setForm({ ...form, default_iva_percent: parseFloat(e.target.value) || 0 })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">IRPF por defecto (%)</label>
            <input type="number" step="0.01" value={form.default_irpf_percent} onChange={(e) => setForm({ ...form, default_irpf_percent: parseFloat(e.target.value) || 0 })} className={inputCls} />
            <p className="text-xs text-[var(--color-navy-500)] mt-1">0 si no aplica retención</p>
          </div>
        </div>
      </div>

      {/* Series de facturación */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Numeración de facturas</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Serie</label>
            <input type="text" value={form.invoice_series} onChange={(e) => setForm({ ...form, invoice_series: e.target.value.toUpperCase() })} className={inputCls} placeholder="F" />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-navy-400)] mb-1">Próximo número</label>
            <input type="number" value={form.invoice_next_number} onChange={(e) => setForm({ ...form, invoice_next_number: parseInt(e.target.value) || 1 })} className={inputCls} />
          </div>
          <div className="flex items-end">
            <p className="text-sm text-[var(--color-navy-300)] bg-[var(--color-navy-700)] rounded-lg px-4 py-2 w-full text-center font-mono">
              {form.invoice_series}-{new Date().getFullYear()}/{String(form.invoice_next_number).padStart(4, "0")}
            </p>
          </div>
        </div>
      </div>

      {/* Verifactu */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-5 mb-6 border border-[var(--color-navy-600)]">
        <h3 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">Verifactu</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.verifactu_enabled} onChange={(e) => setForm({ ...form, verifactu_enabled: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-navy-600)] bg-[var(--color-navy-700)] text-[var(--color-brand-green)] focus:ring-[var(--color-brand-green)]" />
          <div>
            <span className="text-sm text-[var(--color-navy-100)]">Activar Verifactu</span>
            <p className="text-xs text-[var(--color-navy-500)]">Genera hash SHA-256 encadenado y código QR en cada factura emitida. Obligatorio desde julio 2025.</p>
          </div>
        </label>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-3">
        {saved && <span className="text-sm text-[var(--color-brand-green)] flex items-center">✓ Guardado correctamente</span>}
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded-xl font-semibold text-sm hover:opacity-90 transition disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar ajustes fiscales"}
        </button>
      </div>
    </div>
  );
}
