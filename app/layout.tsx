import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Enlaze — Cierra más clientes sin trabajar más horas",
  description:
    "ENLAZE centraliza clientes, presupuestos, seguimiento y operaciones en un solo lugar para empresas de servicios que quieren responder más rápido, vender mejor y tener más control del negocio.",
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

