import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface InvoiceRow {
  id: string;
  invoice_number: string;
  supplier_name: string;
  supplier_nif: string;
  invoice_date: string;
  base_amount: number;
  iva_percentage: number;
  iva_amount: number;
  irpf_percentage: number;
  irpf_amount: number;
  total_amount: number;
  category: string;
  payment_status: string;
}

interface IssuedRow {
  id: string;
  invoice_number: string;
  client_name: string;
  client_nif: string;
  issue_date: string;
  subtotal: number;
  iva_percent: number;
  iva_amount: number;
  irpf_percent: number;
  irpf_amount: number;
  total: number;
  status: string;
  payment_status: string;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    const type = url.searchParams.get("type") || "all"; // received, issued, all
    const period = url.searchParams.get("period") || "year"; // month, quarter, year
    const year = parseInt(url.searchParams.get("year") || new Date().getFullYear().toString());
    const month = url.searchParams.get("month"); // 1-12
    const quarter = url.searchParams.get("quarter"); // 1-4

    if (!userId) {
      return NextResponse.json({ error: "Falta user_id" }, { status: 400 });
    }

    // Calculate date range
    let startDate: string;
    let endDate: string;
    let periodLabel: string;

    if (period === "month" && month) {
      const m = parseInt(month);
      startDate = `${year}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(year, m, 0).getDate();
      endDate = `${year}-${String(m).padStart(2, "0")}-${lastDay}`;
      const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      periodLabel = `${monthNames[m - 1]} ${year}`;
    } else if (period === "quarter" && quarter) {
      const q = parseInt(quarter);
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      startDate = `${year}-${String(startMonth).padStart(2, "0")}-01`;
      const lastDay = new Date(year, endMonth, 0).getDate();
      endDate = `${year}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
      periodLabel = `${q}T ${year}`;
    } else {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
      periodLabel = `${year}`;
    }

    // Fetch data
    let received: InvoiceRow[] = [];
    let issued: IssuedRow[] = [];

    if (type === "received" || type === "all") {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, supplier_name, supplier_nif, invoice_date, base_amount, iva_percentage, iva_amount, irpf_percentage, irpf_amount, total_amount, category, payment_status")
        .eq("user_id", userId)
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate)
        .order("invoice_date", { ascending: true });
      received = (data as InvoiceRow[]) || [];
    }

    if (type === "issued" || type === "all") {
      const { data } = await supabase
        .from("issued_invoices")
        .select("id, invoice_number, client_name, client_nif, issue_date, subtotal, iva_percent, iva_amount, irpf_percent, irpf_amount, total, status, payment_status")
        .eq("user_id", userId)
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: true });
      issued = (data as IssuedRow[]) || [];
    }

    // Get company info
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, nif, address")
      .eq("id", userId)
      .single();

    const companyName = profile?.company_name || "Mi Empresa";
    const companyNif = profile?.nif || "";

    // Build JSON data for PDF generation
    const pdfData = {
      companyName,
      companyNif,
      periodLabel,
      type,
      received: received.map((r) => ({
        number: r.invoice_number,
        supplier: r.supplier_name,
        nif: r.supplier_nif,
        date: r.invoice_date,
        base: Number(r.base_amount || 0),
        iva_pct: Number(r.iva_percentage || 0),
        iva: Number(r.iva_amount || 0),
        irpf_pct: Number(r.irpf_percentage || 0),
        irpf: Number(r.irpf_amount || 0),
        total: Number(r.total_amount || 0),
        status: r.payment_status,
      })),
      issued: issued.map((i) => ({
        number: i.invoice_number,
        client: i.client_name,
        nif: i.client_nif,
        date: i.issue_date,
        base: Number(i.subtotal || 0),
        iva_pct: Number(i.iva_percent || 0),
        iva: Number(i.iva_amount || 0),
        irpf_pct: Number(i.irpf_percent || 0),
        irpf: Number(i.irpf_amount || 0),
        total: Number(i.total || 0),
        status: i.payment_status,
      })),
      totals: {
        received: {
          count: received.length,
          base: received.reduce((s, r) => s + Number(r.base_amount || 0), 0),
          iva: received.reduce((s, r) => s + Number(r.iva_amount || 0), 0),
          irpf: received.reduce((s, r) => s + Number(r.irpf_amount || 0), 0),
          total: received.reduce((s, r) => s + Number(r.total_amount || 0), 0),
        },
        issued: {
          count: issued.length,
          base: issued.reduce((s, i) => s + Number(i.subtotal || 0), 0),
          iva: issued.reduce((s, i) => s + Number(i.iva_amount || 0), 0),
          irpf: issued.reduce((s, i) => s + Number(i.irpf_amount || 0), 0),
          total: issued.reduce((s, i) => s + Number(i.total || 0), 0),
        },
      },
    };

    // Return JSON — the client will generate the PDF
    return NextResponse.json(pdfData);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
