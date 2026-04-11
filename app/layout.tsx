import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Enlaze — El sistema completo para tu empresa de servicios",
  description:
    "CRM, automatización de WhatsApp y email, presupuestos con IA y seguimiento comercial en un mismo panel. Pensado para empresas de reformas, instalaciones y servicios técnicos que quieren ganar más clientes sin añadir más horas.",
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
