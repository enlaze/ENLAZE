import SettingsShell from "@/components/settings/SettingsShell";

/**
 * Ruta canónica de la pestaña Integraciones. NO cambiar el path: es la URL de
 * retorno del OAuth de Google (app/api/auth/google/callback), que vuelve con
 * ?integration_success=true o ?integration_error=...
 */
export default function IntegrationsPage() {
  return <SettingsShell initialTab="integraciones" />;
}
