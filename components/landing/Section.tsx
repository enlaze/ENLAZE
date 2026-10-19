import React from "react";

type SectionProps = {
  children: React.ReactNode;
  id?: string;
  /** Vertical padding class (overrides default) */
  padding?: string;
  /** Extra classes for the outer <section> */
  className?: string;
  /** Extra classes for the inner container */
  innerClassName?: string;
};

/**
 * Section — contenedor de sección de la landing. No pinta fondo propio: todas
 * heredan el de <main> (token landing-paper) y se separan solo con espacio.
 */
export default function Section({
  children,
  id,
  padding = "py-28",
  className = "",
  innerClassName = "",
}: SectionProps) {
  return (
    <section id={id} className={`relative ${padding} ${className}`}>
      <div className={`relative mx-auto max-w-6xl px-6 ${innerClassName}`}>
        {children}
      </div>
    </section>
  );
}
