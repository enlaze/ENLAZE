import type { Metadata } from "next";
import { TRIAL_DAYS } from "@/lib/plans";

const description = `Planes para autónomos y empresas de la construcción. Prueba ${TRIAL_DAYS} días gratis, sin tarjeta. Sin permanencia.`;

export const metadata: Metadata = {
  title: "Precios",
  description,
  openGraph: {
    title: "Precios | Enlaze",
    description,
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
