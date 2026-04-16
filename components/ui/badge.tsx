"use client";

type BadgeVariant =
  | "green"
  | "blue"
  | "yellow"
  | "red"
  | "gray"
  | "purple"
  | "orange";

const variantStyles: Record<BadgeVariant, string> = {
  green:
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60",
  blue:
    "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/60 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/60",
  yellow:
    "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/60",
  red:
    "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/60 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/60",
  gray:
    "bg-navy-50 text-navy-600 ring-1 ring-inset ring-navy-200/60 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-800",
  purple:
    "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200/60 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-800/60",
  orange:
    "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200/60 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-800/60",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export default function Badge({
  children,
  variant = "gray",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
