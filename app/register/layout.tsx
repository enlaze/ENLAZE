import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description:
    "Regístrate en Enlaze y empieza a centralizar la gestión de tu empresa de servicios. Prueba gratis.",
  openGraph: {
    title: "Crear cuenta | Enlaze",
    description:
      "Regístrate en Enlaze y empieza a centralizar la gestión de tu empresa de servicios.",
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
