"use client";

import Link from "next/link";
import React from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  /** Trail from root to current page. The last item is the current page (no link). */
  items: BreadcrumbItem[];
  /** Render a small home glyph before the first item's label. */
  showHomeIcon?: boolean;
  className?: string;
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 text-navy-300 dark:text-zinc-600"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

export default function Breadcrumbs({
  items,
  showHomeIcon = false,
  className = "",
}: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const homeGlyph = i === 0 && showHomeIcon ? <HomeIcon /> : null;

          return (
            <li key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRightIcon />}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={
                    isLast
                      ? "inline-flex items-center gap-1.5 min-w-0 truncate font-medium text-navy-900 dark:text-white"
                      : "inline-flex items-center gap-1.5 text-navy-500 dark:text-zinc-400"
                  }
                >
                  {homeGlyph}
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1.5 text-navy-500 transition-colors hover:text-navy-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {homeGlyph}
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
