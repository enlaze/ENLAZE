"use client";

import React from "react";

/* ─── Generic Card ─────────────────────────────────────────────────── */

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = "", padding = true }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-navy-100 bg-white shadow-sm ${
        padding ? "p-6" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── KPI Stat Card ────────────────────────────────────────────────── */

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: "default" | "green" | "yellow" | "red" | "blue";
  detail?: string;
}

const accentColors: Record<string, string> = {
  default: "text-navy-900",
  green: "text-brand-green",
  yellow: "text-amber-600",
  red: "text-red-600",
  blue: "text-blue-600",
};

export function StatCard({
  label,
  value,
  accent = "default",
  detail,
}: StatCardProps) {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium text-navy-500 uppercase tracking-wider">
        {label}
      </p>
      <p className={`mt-1.5 text-2xl font-bold ${accentColors[accent]}`}>
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-navy-400">{detail}</p>}
    </div>
  );
}

/* ─── Section Header inside Card ───────────────────────────────────── */

interface CardHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export function CardHeader({ title, action }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-navy-100 px-6 py-4">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      {action}
    </div>
  );
}
