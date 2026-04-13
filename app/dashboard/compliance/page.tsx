"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";

interface ComplianceCheck {
  area: string;
  label: string;
  href: string;
  status: "green" | "yellow" | "red";
  detail: string;
  icon: string;
}

export default function ComplianceDashboardPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);

  async function loadChecks() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Load data for checks in parallel
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
        area: "audit", label: "Audit Trail", href: "/dashboard/audit-log",
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

  useEffect(() => { loadChecks(); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  const greens = checks.filter(c => c.status === "green").length;
  const yellows = checks.filter(c => c.status === "yellow").length;
  const reds = checks.filter(c => c.status === "red").length;

  const statusColors = {
    green: "bg-emerald-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
  };

  const statusLabels = {
    green: "Cumple",
    yellow: "Atención",
    red: "Acción requerida",
  };

  const overallStatus = reds > 0 ? "red" : yellows > 0 ? "yellow" : "green";

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-[var(--color-navy-50)] mb-2">Compliance</h1>
      <p className="text-[var(--color-navy-400)] text-sm mb-6">
        Estado de cumplimiento legal, fiscal, privacidad y seguridad de tu cuenta.
      </p>

      {/* Overall status */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6 mb-6 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full ${statusColors[overallStatus]} flex items-center justify-center text-white text-xl`}>
          {overallStatus === "green" ? "✓" : overallStatus === "yellow" ? "!" : "✕"}
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--color-navy-50)]">
            {overallStatus === "green" ? "Todo en orden" : overallStatus === "yellow" ? "Algunos puntos requieren atención" : "Hay acciones requeridas"}
          </p>
          <p className="text-sm text-[var(--color-navy-400)]">
            {greens} cumple · {yellows} atención · {reds} acción requerida
          </p>
        </div>
      </div>

      {/* Checks grid */}
      <div className="space-y-3">
        {checks.map((check) => (
          <Link key={check.area} href={check.href}>
            <div className="bg-[var(--color-navy-800)] rounded-xl p-5 hover:bg-[var(--color-navy-750)] transition cursor-pointer flex items-center gap-4 mb-3">
              <div className="text-2xl">{check.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-[var(--color-navy-100)]">{check.label}</h3>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                    check.status === "green" ? "bg-emerald-900/30 text-emerald-300" :
                    check.status === "yellow" ? "bg-yellow-900/30 text-yellow-300" :
                    "bg-red-900/30 text-red-300"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[check.status]}`} />
                    {statusLabels[check.status]}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-navy-400)]">{check.detail}</p>
              </div>
              <span className="text-[var(--color-navy-600)]">→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
