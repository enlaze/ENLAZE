import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Enlaze — Crea presupuestos que venden, en segundos",
  description:
    "Enlaze es el CRM con IA para empresas de reformas, instalaciones y servicios técnicos. Gestiona clientes, genera presupuestos profesionales y cierra más obras, sin pelearte con hojas de cálculo.",
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
