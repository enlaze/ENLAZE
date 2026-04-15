import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Planes flexibles para empresas de servicios de cualquier tamaño. Empieza gratis y escala cuando lo necesites.",
  openGraph: {
    title: "Precios | Enlaze",
    description:
      "Planes flexibles para empresas de servicios. Empieza gratis y escala cuando lo necesites.",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
