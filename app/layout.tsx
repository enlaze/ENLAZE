import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Enlaze – Automatiza la comunicación de tu empresa",
  description:
    "WhatsApp, emails, recordatorios y calendario en un solo lugar.",
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
