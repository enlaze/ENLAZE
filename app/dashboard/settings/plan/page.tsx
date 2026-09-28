import SettingsShell from "@/components/settings/SettingsShell";

/** Ruta canónica de la pestaña Plan y facturación (y la vuelta de Stripe). */
export default function PlanSettingsPage() {
  return <SettingsShell initialTab="plan" />;
}
