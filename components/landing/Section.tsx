import React from "react";

type Tone = "light" | "muted" | "dark" | "transparent";

type SectionProps = {
  children: React.ReactNode;
  id?: string;
  /** Visual tone of the section background */
  tone?: Tone;
  /** Vertical padding class (overrides default) */
  padding?: string;
  /** Extra classes for the outer <section> */
  className?: string;
  /** Extra classes for the inner container */
  innerClassName?: string;
  /** Whether to add top/bottom borders (useful for muted tone) */
  bordered?: boolean;
};

/**
 * Section — consistent landing section wrapper with tone-aware background.
 * Keeps the same visual tokens already used across the original landing
 * (max-w-6xl, px-6, py-28, navy-50/40 muted band, navy-900 dark band).
 */
export default function Section({
  children,
  id,
  tone = "light",
  padding = "py-28",
  className = "",
  innerClassName = "",
  bordered = false,
}: SectionProps) {
  const toneClasses: Record<Tone, string> = {
    // light hereda el background del <main> (cream #f4f7f5) — así
    // unificamos todas las secciones claras de la landing al mismo tono.
    light: "",
    muted: "bg-navy-50/40",
    dark: "bg-navy-900",
    transparent: "",
  };

  const borderClass =
    bordered && tone !== "dark" ? "border-y border-navy-100" : "";

  return (
    <section
      id={id}
      className={`relative ${toneClasses[tone]} ${borderClass} ${padding} transition-colors ${className}`}
    >
      <div className={`relative mx-auto max-w-6xl px-6 ${innerClassName}`}>
        {children}
      </div>
    </section>
  );
}
