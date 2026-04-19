import React from "react";

type IconVariant = "navy" | "green" | "red" | "muted";

type FeatureCardProps = {
  /** Icon rendered inside the square tile */
  icon?: React.ReactNode;
  /** Card title */
  title: React.ReactNode;
  /** Card description */
  description?: React.ReactNode;
  /** Icon tile color variant */
  iconVariant?: IconVariant;
  /** Card padding class (default p-7) */
  padding?: string;
  /** Extra classes for the root <article> */
  className?: string;
  /** Optional custom content below the description (e.g. footer) */
  children?: React.ReactNode;
  /** If true, disable the hover icon color swap */
  staticIcon?: boolean;
};

/**
 * FeatureCard — reusable landing card preserving the original look:
 * rounded-2xl, border-navy-100, white background, subtle shadow,
 * lift-on-hover. The icon tile is recolored via the `iconVariant` prop.
 */
export default function FeatureCard({
  icon,
  title,
  description,
  iconVariant = "navy",
  padding = "p-7",
  className = "",
  children,
  staticIcon = false,
}: FeatureCardProps) {
  const iconBase =
    "flex items-center justify-center rounded-xl ring-1 ring-inset transition-colors duration-300";

  const iconVariants: Record<IconVariant, string> = {
    navy: staticIcon
      ? "bg-navy-50 text-navy-700 ring-navy-100 h-11 w-11"
      : "bg-navy-50 text-navy-700 ring-navy-100 h-11 w-11 group-hover:bg-brand-green/10 group-hover:text-brand-green group-hover:ring-brand-green/15",
    green: "bg-brand-green/10 text-brand-green ring-brand-green/20 h-11 w-11",
    red: "bg-red-50 text-red-500 ring-red-100 h-10 w-10",
    muted: "bg-navy-100 text-navy-500 ring-navy-200 h-10 w-10",
  };

  return (
    <article
      className={`
        group relative overflow-hidden rounded-2xl border border-navy-100 bg-white ${padding}
        shadow-[0_1px_2px_rgba(10,25,41,0.04)]
        transition-all duration-300 ease-out
        hover:-translate-y-[2px] hover:border-navy-200
        hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
        ${className}
      `}
    >
      {icon && (
        <div className={`${iconBase} ${iconVariants[iconVariant]}`}>
          {icon}
        </div>
      )}
      <h3 className="mt-5 text-[15.5px] font-semibold tracking-tight text-navy-900 transition-colors md:text-[17px]">
        {title}
      </h3>
      {description && (
        <p className="mt-2 text-[14.5px] leading-relaxed text-navy-500 transition-colors">
          {description}
        </p>
      )}
      {children}
    </article>
  );
}
