"use client";

import { useMemo } from "react";

// ─────────────────────────────────────────────────────────────
// Password strength meter.
//
// Shows 4-bar visual + criteria checklist.
// Score 0–4: 0 débil · 1 floja · 2 aceptable · 3 fuerte · 4 muy fuerte
// ─────────────────────────────────────────────────────────────

interface Check {
  id: string;
  label: string;
  ok: boolean;
}

function evaluate(pw: string): { score: number; checks: Check[] } {
  const checks: Check[] = [
    { id: "len", label: "Al menos 8 caracteres", ok: pw.length >= 8 },
    { id: "case", label: "Mayúsculas y minúsculas", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { id: "num", label: "Al menos un número", ok: /\d/.test(pw) },
    { id: "sym", label: "Al menos un símbolo", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.ok).length;
  return { score, checks };
}

const labels = ["Débil", "Floja", "Aceptable", "Fuerte", "Muy fuerte"];
const labelColors = [
  "text-red-600 dark:text-red-400",
  "text-orange-600 dark:text-orange-400",
  "text-amber-600 dark:text-amber-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-emerald-600 dark:text-emerald-400",
];
const barColors = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-emerald-500",
];

export default function PasswordStrength({ password }: { password: string }) {
  const { score, checks } = useMemo(() => evaluate(password), [password]);
  const show = password.length > 0;
  if (!show) return null;

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < score
                ? barColors[score]
                : "bg-navy-100 dark:bg-zinc-800"
            }`}
          />
        ))}
        <span className={`ml-2 text-xs font-semibold ${labelColors[score]}`}>
          {labels[score]}
        </span>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c) => (
          <li
            key={c.id}
            className={`flex items-center gap-1.5 text-[11px] ${
              c.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-navy-500 dark:text-zinc-500"
            }`}
          >
            <span aria-hidden>{c.ok ? "✓" : "○"}</span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
