import SettingsShell from "@/components/settings/SettingsShell";

/**
 * Ruta histórica: los datos fiscales viven ahora dentro de la pestaña
 * "Empresa y datos fiscales". Se conserva para no romper enlaces existentes
 * (p. ej. app/dashboard/issued-invoices).
 */
export default function FiscalSettingsPage() {
  return <SettingsShell initialTab="empresa" />;
}
