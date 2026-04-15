import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://enlaze.es";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Enlaze — Cierra más clientes sin trabajar más horas",
    template: "%s | Enlaze",
  },
  description:
    "ENLAZE centraliza clientes, presupuestos, seguimiento y operaciones en un solo lugar para empresas de servicios que quieren responder más rápido, vender mejor y tener más control del negocio.",
  keywords: [
    "CRM servicios",
    "gestión clientes",
    "presupuestos online",
    "software empresas servicios",
    "automatización ventas",
    "enlaze",
  ],
  authors: [{ name: "Enlaze" }],
  creator: "Enlaze",
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: siteUrl,
    siteName: "Enlaze",
    title: "Enlaze — Cierra más clientes sin trabajar más horas",
    description:
      "Centraliza clientes, presupuestos, seguimiento y operaciones en un solo lugar. Responde más rápido, vende mejor y ten más control del negocio.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Enlaze — CRM para empresas de servicios",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Enlaze — Cierra más clientes sin trabajar más horas",
    description:
      "Centraliza clientes, presupuestos, seguimiento y operaciones en un solo lugar.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
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

