"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import Loading from "@/components/ui/loading";

interface ComplianceCheck {
  area: string;
  label: string;
  href: string;
  status: "green" | "yellow" | "red";
  detail: string;
  icon: string;
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
        icon: "🔒",
        status: hasTerms && hasPrivacy && hasActivities && allDpaSigned ? "green" : (!hasTerms || !hasPrivacy) ? "red" : "yellow",
        detail: hasTerms && hasPrivacy
          ? `Términos y privacidad aceptados. ${hasActivities ? "Registro Art.30 activo." : "Falta registro Art.30."} ${allDpaSigned ? "DPAs firmados." : "DPAs pendientes."}`
          : "Faltan aceptaciones legales obligatorias.",
      },
      {
        area: "fiscal", label: "Fiscal y Facturación", href: "/dashboard/compliance/fiscal",
        icon: "📊",
        status: allHaveHash && drafts === 0 ? "green" : drafts > 0 ? "yellow" : inv.length === 0 ? "yellow" : "red",
        detail: inv.length === 0
          ? "Sin facturas emitidas todavía."
          : `${inv.length} facturas. ${allHaveHash ? "Todas con hash Verifactu." : "Faltan hashes."} ${drafts > 0 ? `${drafts} borradores pendientes.` : ""}`,
      },
      {
        area: "ai", label: "Inteligencia Artificial", href: "/dashboard/compliance/ai",
        icon: "🤖",
        status: runs.length === 0 ? "yellow" : unreviewedAi === 0 ? "green" : "yellow",
        detail: runs.length === 0
          ? "Sin ejecuciones de IA registradas."
          : `${runs.length} ejecuciones. ${unreviewedAi > 0 ? `${unreviewedAi} sin revisar.` : "Todas revisadas."}`,
      },
      {
        area: "security", label: "Seguridad", href: "/dashboard/compliance/security",
        icon: "🛡️",
        status: openIncidents === 0 ? "green" : "red",
        detail: openIncidents === 0
          ? "Sin incidentes abiertos."
          : `${openIncidents} incidente(s) sin resolver.`,
      },
      {
        area: "audit", label: "Historial de actividad", href: "/dashboard/audit-log",
        icon: "📋",
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
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
  };

  const statusLabels = {
    green: "Cumple",
    yellow: "Atención",
    red: "Acción requerida",
  };

  const statusBadge = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    yellow: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900",
  };

  const overallStatus = reds > 0 ? "red" : yellows > 0 ? "yellow" : "green";

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Cumplimiento"
        description="Estado de cumplimiento legal, fiscal, privacidad y seguridad de tu cuenta."
      />

      {/* Overall status */}
      <Card className="mb-6 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full ${statusDot[overallStatus]} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
          {overallStatus === "green" ? "✓" : overallStatus === "yellow" ? "!" : "✕"}
        </div>
        <div>
          <p className="text-lg font-bold text-navy-900 dark:text-white">
            {overallStatus === "green" ? "Todo en orden" : overallStatus === "yellow" ? "Algunos puntos requieren atención" : "Hay acciones requeridas"}
          </p>
          <p className="text-sm text-navy-500 dark:text-zinc-400">
            {greens} cumple · {yellows} atención · {reds} acción requerida
          </p>
        </div>
      </Card>

      {/* Checks list */}
      <div className="space-y-3">
        {checks.map((check) => (
          <Link key={check.area} href={check.href} className="group block">
            <div className="flex cursor-pointer items-center gap-4 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm transition-colors group-hover:border-brand-green/40 group-hover:bg-navy-50 group-hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:group-hover:border-brand-green/40 dark:group-hover:bg-zinc-800/60 dark:shadow-none">
              <div className="shrink-0 text-2xl">{check.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-navy-900 group-hover:text-navy-900 dark:text-white dark:group-hover:text-white">
                    {check.label}
                  </h3>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge[check.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot[check.status]}`} />
                    {statusLabels[check.status]}
                  </span>
                </div>
                <p className="text-xs text-navy-600 group-hover:text-navy-700 dark:text-zinc-400 dark:group-hover:text-zinc-300">
                  {check.detail}
                </p>
              </div>
              <span className="shrink-0 text-lg text-navy-400 group-hover:text-brand-green dark:text-zinc-600 dark:group-hover:text-brand-green">→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
