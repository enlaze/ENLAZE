"use client";

import React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number;
  countLabel?: string;
  actions?: React.ReactNode;
  titleAdornment?: React.ReactNode;
}

export default function PageHeader({
  title,
  description,
  count,
  countLabel = "en total",
  actions,
  titleAdornment,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white tracking-tight">
            {title}
          </h1>
          {titleAdornment}
        </div>
        {description && (
          <p className="mt-1 text-sm text-navy-500 dark:text-zinc-400">{description}</p>
        )}
        {count !== undefined && (
          <p className="mt-1 text-sm text-navy-500 dark:text-zinc-400">
            {count} {countLabel}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
