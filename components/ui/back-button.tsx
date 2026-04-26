"use client";

import { usePathname, useRouter } from "next/navigation";

interface BackButtonProps {
  fallbackHref?: string;
  label?: string;
  className?: string;
  ariaLabel?: string;
}

export default function BackButton({
  fallbackHref = "/dashboard",
  label = "Volver",
  className = "",
  ariaLabel,
}: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleClick() {
    const before = pathname;
    router.back();
    window.setTimeout(() => {
      if (window.location.pathname === before) {
        router.push(fallbackHref);
      }
    }, 120);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel ?? label}
      className={
        "group mb-6 inline-flex items-center gap-1.5 rounded-xl " +
        "border border-navy-200/70 bg-white/60 px-3 py-1.5 text-sm font-medium text-navy-600 " +
        "shadow-sm backdrop-blur-md transition-all duration-200 " +
        "hover:-translate-y-px hover:border-navy-300 hover:bg-white hover:text-navy-900 hover:shadow-md " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-300 focus-visible:ring-offset-2 " +
        "dark:border-zinc-800/70 dark:bg-zinc-900/50 dark:text-zinc-300 " +
        "dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-white " +
        "dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950 " +
        className
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
