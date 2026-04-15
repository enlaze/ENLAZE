import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description:
    "Accede a tu cuenta de Enlaze y gestiona clientes, presupuestos y operaciones desde un solo lugar.",
  openGraph: {
    title: "Iniciar sesión | Enlaze",
    description:
      "Accede a tu cuenta de Enlaze y gestiona clientes, presupuestos y operaciones desde un solo lugar.",
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
