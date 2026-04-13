import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SearchResult {
  id: string;
  type: "client" | "budget" | "invoice" | "project" | "payment";
  title: string;
  subtitle: string;
  icon: string;
  href: string;
  relevance: number;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const userId = req.nextUrl.searchParams.get("user_id");

  if (!q || q.length < 2 || !userId) {
    return NextResponse.json({ results: [] });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const query = `%${q.toLowerCase()}%`;

  const results: SearchResult[] = [];

  // Search in parallel across all entities
  const [clientsRes, budgetsRes, invoicesRes, projectsRes, paymentsRes] = await Promise.all([
    // Clients
    supabase
      .from("clients")
      .select("id, name, email, phone, status")
      .eq("user_id", userId)
      .or(`name.ilike.${query},email.ilike.${query},phone.ilike.${query}`)
      .limit(5),

    // Budgets
    supabase
      .from("budgets")
      .select("id, budget_number, title, client_name, status, total")
      .eq("user_id", userId)
      .or(`budget_number.ilike.${query},title.ilike.${query},client_name.ilike.${query}`)
      .limit(5),

    // Issued Invoices
    supabase
      .from("issued_invoices")
      .select("id, invoice_number, client_name, status, total")
      .eq("user_id", userId)
      .or(`invoice_number.ilike.${query},client_name.ilike.${query}`)
      .limit(5),

    // Projects
    supabase
      .from("projects")
      .select("id, name, address, client_name, status")
      .eq("user_id", userId)
      .or(`name.ilike.${query},address.ilike.${query},client_name.ilike.${query}`)
      .limit(5),

    // Payments
    supabase
      .from("payments")
      .select("id, concept, reference, amount, payment_date, payment_method")
      .eq("user_id", userId)
      .or(`concept.ilike.${query},reference.ilike.${query}`)
      .limit(5),
  ]);

  // Process clients
  if (clientsRes.data) {
    for (const c of clientsRes.data) {
      results.push({
        id: c.id,
        type: "client",
        title: c.name || "Sin nombre",
        subtitle: [c.email, c.phone, c.status].filter(Boolean).join(" · "),
        icon: "👥",
        href: `/dashboard/clientes`,
        relevance: (c.name || "").toLowerCase().startsWith(q.toLowerCase()) ? 10 : 5,
      });
    }
  }

  // Process budgets
  if (budgetsRes.data) {
    for (const b of budgetsRes.data) {
      results.push({
        id: b.id,
        type: "budget",
        title: b.title || b.budget_number,
        subtitle: [b.client_name, b.status, b.total ? `€${Number(b.total).toLocaleString("es-ES")}` : null].filter(Boolean).join(" · "),
        icon: "📋",
        href: `/dashboard/budgets/${b.id}`,
        relevance: (b.budget_number || "").toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
      });
    }
  }

  // Process invoices
  if (invoicesRes.data) {
    for (const inv of invoicesRes.data) {
      results.push({
        id: inv.id,
        type: "invoice",
        title: inv.invoice_number,
        subtitle: [inv.client_name, inv.status, inv.total ? `€${Number(inv.total).toLocaleString("es-ES")}` : null].filter(Boolean).join(" · "),
        icon: "🧾",
        href: `/dashboard/issued-invoices/${inv.id}`,
        relevance: (inv.invoice_number || "").toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
      });
    }
  }

  // Process projects
  if (projectsRes.data) {
    for (const p of projectsRes.data) {
      results.push({
        id: p.id,
        type: "project",
        title: p.name,
        subtitle: [p.client_name, p.address, p.status].filter(Boolean).join(" · "),
        icon: "🏗️",
        href: `/dashboard/projects/${p.id}`,
        relevance: (p.name || "").toLowerCase().startsWith(q.toLowerCase()) ? 10 : 5,
      });
    }
  }

  // Process payments
  if (paymentsRes.data) {
    for (const pay of paymentsRes.data) {
      results.push({
        id: pay.id,
        type: "payment",
        title: pay.concept,
        subtitle: [pay.reference, pay.payment_method, `€${Number(pay.amount).toLocaleString("es-ES")}`, pay.payment_date].filter(Boolean).join(" · "),
        icon: "💵",
        href: `/dashboard/payments`,
        relevance: 3,
      });
    }
  }

  // Sort by relevance desc
  results.sort((a, b) => b.relevance - a.relevance);

  return NextResponse.json({ results: results.slice(0, 15) });
}
