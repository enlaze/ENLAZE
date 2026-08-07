import SettingsShell from "@/components/settings/SettingsShell";

/**
 * Ajustes. El panel es único: la sub-navegación cambia de pestaña sin recargar.
 * Las rutas antiguas (/fiscal, /sector, /notifications, /integrations) siguen
 * existiendo y montan este mismo shell con su pestaña ya seleccionada.
 */
export default function SettingsPage() {
  return <SettingsShell initialTab="empresa" />;
}
