"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import Loading from "@/components/ui/loading";

type IconName = "lock" | "receipt" | "bot" | "shield" | "clipboard";

interface ComplianceCheck {
  area: string;
  label: string;
  href: string;
  status: "green" | "yellow" | "red";
  detail: string;
  icon: IconName;
}

/* Inline icon paths (lucide-style), matching the rest of the app's SVG icons. */
const iconPaths: Record<IconName, React.ReactNode> = {
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M14 8H8" />
      <path d="M16 12H8" />
      <path d="M13 16H8" />
    </>
  ),
  bot: (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  clipboard: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
};

function CheckIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

export default function ComplianceDashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);

  async function loadChecks() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [
      { data: legalAcceptances },
      { data: invoices },
      { data: aiRuns },
      { data: incidents },
      { data: subprocessors },
      { data: activities },
      { data: activityLog },
    ] = await Promise.all([
      supabase.from("legal_acceptances").select("document_type").eq("user_id", user.id),
      supabase.from("issued_invoices").select("id, verifactu_hash, facturae_xml, status").eq("user_id", user.id),
      supabase.from("ai_runs").select("id, human_reviewed").eq("user_id", user.id),
      supabase.from("security_incidents").select("id, resolved_at").eq("reported_by", user.id),
      supabase.from("subprocessors").select("id, dpa_signed").eq("is_active", true),
      supabase.from("processing_activities").select("id"),
      supabase.from("activity_log").select("id").eq("user_id", user.id).limit(1),
    ]);

    const acceptedDocs = new Set((legalAcceptances || []).map(a => a.document_type));
    const hasTerms = acceptedDocs.has("terms");
    const hasPrivacy = acceptedDocs.has("privacy");
    const inv = invoices || [];
    const allHaveHash = inv.length > 0 && inv.every(i => i.verifactu_hash);
    const drafts = inv.filter(i => i.status === "draft").length;
    const runs = aiRuns || [];
    const unreviewedAi = runs.filter(r => !r.human_reviewed).length;
    const openIncidents = (incidents || []).filter(i => !i.resolved_at).length;
    const allDpaSigned = (subprocessors || []).every(s => s.dpa_signed);
    const hasActivities = (activities || []).length > 0;
    const hasAuditLog = (activityLog || []).length > 0;

    const result: ComplianceCheck[] = [
      {
        area: "legal", label: "Legal y Privacidad", href: "/dashboard/compliance/privacy",
        icon: "lock",
        status: hasTerms && hasPrivacy && hasActivities && allDpaSigned ? "green" : (!hasTerms || !hasPrivacy) ? "red" : "yellow",
        detail: hasTerms && hasPrivacy
          ? `Términos y privacidad aceptados. ${hasActivities ? "Registro Art.30 activo." : "Falta registro Art.30."} ${allDpaSigned ? "DPAs firmados." : "DPAs pendientes."}`
          : "Faltan aceptaciones legales obligatorias.",
      },
      {
        area: "fiscal", label: "Fiscal y Facturación", href: "/dashboard/compliance/fiscal",
        icon: "receipt",
        status: allHaveHash && drafts === 0 ? "green" : drafts > 0 ? "yellow" : inv.length === 0 ? "yellow" : "red",
        detail: inv.length === 0
          ? "Sin facturas emitidas todavía."
          : `${inv.length} facturas. ${allHaveHash ? "Todas con hash Verifactu." : "Faltan hashes."} ${drafts > 0 ? `${drafts} borradores pendientes.` : ""}`,
      },
      {
        area: "ai", label: "Inteligencia Artificial", href: "/dashboard/compliance/ai",
        icon: "bot",
        status: runs.length === 0 ? "yellow" : unreviewedAi === 0 ? "green" : "yellow",
        detail: runs.length === 0
          ? "Sin ejecuciones de IA registradas."
          : `${runs.length} ejecuciones. ${unreviewedAi > 0 ? `${unreviewedAi} sin revisar.` : "Todas revisadas."}`,
      },
      {
        area: "security", label: "Seguridad", href: "/dashboard/compliance/security",
        icon: "shield",
        status: openIncidents === 0 ? "green" : "red",
        detail: openIncidents === 0
          ? "Sin incidentes abiertos."
          : `${openIncidents} incidente(s) sin resolver.`,
      },
      {
        area: "audit", label: "Historial de actividad", href: "/dashboard/audit-log",
        icon: "clipboard",
        status: hasAuditLog ? "green" : "yellow",
        detail: hasAuditLog
          ? "Registro de actividad activo."
          : "Sin actividad registrada todavía.",
      },
    ];

    setChecks(result);
    setLoading(false);
  }

  useEffect(() => {
    loadChecks(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;

  const greens = checks.filter(c => c.status === "green").length;
  const yellows = checks.filter(c => c.status === "yellow").length;
  const reds = checks.filter(c => c.status === "red").length;

  const statusDot = {
    green: "bg-[#00c896]",
    yellow: "bg-[#f59e0b]",
    red: "bg-[#ef4444]",
  };

  const statusLabels = {
    green: "Cumple",
    yellow: "Atención",
    red: "Acción requerida",
  };

  const statusBadge = {
    green: "bg-[#e6faf4] text-[#00795b] border-[#bdeede] dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    yellow: "bg-[#fef3e2] text-[#b45309] border-[#f8e0b8] dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    red: "bg-[#fee2e2] text-[#b91c1c] border-[#fecaca] dark:bg-red-950/50 dark:text-red-300 dark:border-red-900",
  };

  /* Tinted circle behind each row icon, keyed by that row's status. */
  const iconWrap = {
    green: "bg-[#e6faf4] text-[#00a37b] dark:bg-emerald-950/50 dark:text-emerald-300",
    yellow: "bg-[#fef3e2] text-[#d97706] dark:bg-amber-950/50 dark:text-amber-300",
    red: "bg-[#fee2e2] text-[#dc2626] dark:bg-red-950/50 dark:text-red-300",
  };

  const overallStatus = reds > 0 ? "red" : yellows > 0 ? "yellow" : "green";

  const overallTitle =
    overallStatus === "green"
      ? "Todo en orden"
      : overallStatus === "yellow"
        ? "Algunos puntos requieren atención"
        : "Hay acciones requeridas";

  /* Summary counts: only the statuses actually present, as in the design. */
  const summaryCounts = [
    { key: "green" as const, count: greens, label: "cumple" },
    { key: "yellow" as const, count: yellows, label: "atención" },
    { key: "red" as const, count: reds, label: "acción requerida" },
  ].filter(c => c.count > 0);

  return (
    <div className="mx-auto max-w-[880px]">
      <h1 className="text-[32px] font-bold tracking-[-0.02em] text-[#0f172a] dark:text-white">
        Cumplimiento
      </h1>
      <p className="mb-7 mt-2 text-[15px] text-[#64748b] dark:text-zinc-400">
        Estado de cumplimiento legal, fiscal, privacidad y seguridad de tu cuenta.
      </p>

      {/* Overall status */}
      <div className="mb-7 flex items-center gap-5 rounded-2xl border border-[#e8edf2] bg-white px-7 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <div className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full ${iconWrap[overallStatus]}`}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {overallStatus === "green" ? (
              <>
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                <path d="m9 12 2 2 4-4" />
              </>
            ) : (
              <>
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </>
            )}
          </svg>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[19px] font-bold tracking-[-0.01em] text-[#0f172a] dark:text-white">
            {overallTitle}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-[#64748b] dark:text-zinc-400">
            {summaryCounts.map(({ key, count, label }) => (
              <span key={key} className="inline-flex items-center gap-[7px]">
                <span className={`h-2 w-2 rounded-full ${statusDot[key]}`} />
                {count} {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Checks list */}
      <div className="flex flex-col gap-3">
        {checks.map((check) => (
          <Link key={check.area} href={check.href} className="group block">
            <div className="flex cursor-pointer items-center gap-[18px] rounded-[14px] border border-[#e8edf2] bg-white px-6 py-5 transition-[border-color,box-shadow] duration-150 group-hover:border-[#c7ded5] group-hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] dark:border-zinc-800 dark:bg-zinc-900 dark:group-hover:border-brand-green/40 dark:group-hover:shadow-none">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconWrap[check.status]}`}>
                <CheckIcon name={check.icon} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-base font-semibold text-[#0f172a] dark:text-white">
                    {check.label}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12.5px] font-semibold ${statusBadge[check.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot[check.status]}`} />
                    {statusLabels[check.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[#64748b] dark:text-zinc-400">
                  {check.detail}
                </p>
              </div>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-[#94a3b8] dark:text-zinc-600"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
