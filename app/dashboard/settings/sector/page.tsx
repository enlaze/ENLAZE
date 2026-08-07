import SettingsShell from "@/components/settings/SettingsShell";

/**
 * Ruta histórica: la elección de sector/subsector vive ahora en la sección
 * "Sector y actividad" de la pestaña "Empresa y datos fiscales".
 */
export default function SectorSettingsPage() {
  return <SettingsShell initialTab="empresa" />;
}
