"use client";

import React from "react";

/* ─── Shared input class ───────────────────────────────────────────── */

export const inputBase =
  "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:focus:ring-zinc-700/60";

/* ─── FormField wrapper ────────────────────────────────────────────── */

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}

export function FormField({
  label,
  required,
  children,
  className = "",
  hint,
}: FormFieldProps) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-400 dark:text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-navy-400 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}

/* ─── Input ────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input(props: InputProps) {
  return <input {...props} className={`${inputBase} ${props.className || ""}`} />;
}

/* ─── Select ───────────────────────────────────────────────────────── */

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export function Select({ children, ...props }: SelectProps) {
  return (
    <select {...props} className={`${inputBase} ${props.className || ""}`}>
      {children}
    </select>
  );
}

/* ─── Textarea ─────────────────────────────────────────────────────── */

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea(props: TextareaProps) {
  return (
    <textarea
      {...props}
      className={`${inputBase} resize-none ${props.className || ""}`}
    />
  );
}

/* ─── Search Input ─────────────────────────────────────────────────── */

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
  className = "",
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 dark:text-zinc-500"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputBase} pl-9`}
      />
    </div>
  );
}
