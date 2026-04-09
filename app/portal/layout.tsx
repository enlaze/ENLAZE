import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal de Cliente — Enlaze",
  description: "Consulta el estado de tu obra, presupuestos, facturas y cambios.",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-navy-900)] text-[var(--color-navy-50)]">
      {children}
    </div>
  );
}
