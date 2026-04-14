import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Enlaze — Cierra más clientes sin trabajar más horas",
  description:
    "Enlaze contesta a tus clientes, genera presupuestos con IA y hace el seguimiento por ti. Para empresas de reformas, instalaciones y servicios técnicos que quieren crecer sin añadir más horas de oficina.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-white text-navy-900 antialiased">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}

