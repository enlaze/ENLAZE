"use client";

import React from "react";
import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-green text-white font-semibold shadow-sm shadow-brand-green/20 hover:bg-brand-green-dark dark:hover:bg-brand-green-dark focus-visible:ring-2 focus-visible:ring-brand-green/50 focus-visible:ring-offset-2",
  secondary:
    "border border-navy-200 bg-white text-navy-700 font-medium hover:bg-navy-50 hover:border-navy-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:border-zinc-700 focus-visible:ring-2 focus-visible:ring-navy-300 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-600",
  ghost:
    "text-navy-600 font-medium hover:bg-navy-50 hover:text-navy-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white focus-visible:ring-2 focus-visible:ring-navy-200 dark:focus-visible:ring-zinc-700",
  danger:
    "text-red-600 font-medium hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 focus-visible:ring-2 focus-visible:ring-red-300 dark:focus-visible:ring-red-900",
  subtle:
    "bg-brand-green/10 text-brand-green font-semibold hover:bg-brand-green/15 dark:bg-brand-green/15 dark:text-brand-green dark:hover:bg-brand-green/25 focus-visible:ring-2 focus-visible:ring-brand-green/40",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "rounded-lg px-3 py-1.5 text-xs",
  md: "rounded-xl px-4 py-2.5 text-sm",
  lg: "rounded-xl px-5 py-3 text-sm",
  icon: "rounded-xl h-9 w-9 p-0 text-sm",
};

const baseStyles =
  "inline-flex items-center justify-center gap-2 transition-colors outline-none focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none cursor-pointer";

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  // Icon-only buttons must have aria-label for a11y
  if (
    size === "icon" &&
    !props["aria-label"] &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn("<Button size=\"icon\"> requires aria-label for accessibility");
  }
  return (
    <button
      type={props.type ?? "button"}
      {...props}
      disabled={disabled || loading}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

interface LinkButtonProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      {...rest}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * Compact icon-only button. Always require aria-label.
 * Use for ✕ close, → next, ⋮ menu, etc.
 */
export function IconButton({
  variant = "ghost",
  className = "",
  ...props
}: ButtonProps) {
  return <Button variant={variant} size="icon" className={className} {...props} />;
}
