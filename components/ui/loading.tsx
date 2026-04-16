"use client";

export default function Loading() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-navy-200 border-t-brand-green dark:border-zinc-800 dark:border-t-brand-green" />
    </div>
  );
}
