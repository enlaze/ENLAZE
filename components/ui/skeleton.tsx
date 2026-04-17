"use client";

import { CSSProperties, HTMLAttributes } from "react";

// ─────────────────────────────────────────────────────────────
// Skeleton — shimmer placeholders for loading states.
//
//   <Skeleton className="h-6 w-40" />
//   <SkeletonCircle size={40} />
//   <SkeletonText lines={3} />
//   <SkeletonTable rows={5} cols={4} />
// ─────────────────────────────────────────────────────────────

const baseClass =
  "relative overflow-hidden rounded-md bg-navy-100 dark:bg-zinc-800 isolate";

const shimmerClass =
  "after:absolute after:inset-0 after:-translate-x-full after:animate-[skeleton-shimmer_1.6s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/40 after:to-transparent dark:after:via-zinc-700/40";

const styleTag = (
  <style>{`
    @keyframes skeleton-shimmer {
      100% { transform: translateX(100%); }
    }
  `}</style>
);

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ className = "", ...rest }: SkeletonProps) {
  return (
    <>
      {styleTag}
      <div
        aria-hidden="true"
        className={`${baseClass} ${shimmerClass} ${className}`}
        {...rest}
      />
    </>
  );
}

export function SkeletonCircle({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={`shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-navy-100 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div className="flex items-center gap-3">
        <SkeletonCircle size={40} />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <Skeleton className="mt-4 h-20 w-full" />
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-4 h-8 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid border-b border-navy-100 bg-navy-50/50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "1rem" }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 w-20" />
        ))}
      </div>
      <div className="divide-y divide-navy-100 dark:divide-zinc-800">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={`r-${r}`}
            className="grid px-6 py-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "1rem" }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={`c-${r}-${c}`}
                className={`h-3 ${c === 0 ? "w-2/3" : "w-1/2"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
