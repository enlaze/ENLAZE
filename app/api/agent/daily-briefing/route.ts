import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, verifyAgentOrBrowserRequest, isErrorResponse } from "../_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    
    const { userId } = auth;
    const authHeader = req.headers.get("authorization");

    // Construct the base URL robustly
    const baseUrl = req.nextUrl.origin;

    const fetchModule = async (modulePath: string) => {
      const url = `${baseUrl}/api/agent/${modulePath}/summary?user_id=${userId}`;
      const headers: Record<string, string> = {};
      const expectedKey = process.env.AGENT_API_KEY;
      if (expectedKey) {
        headers["Authorization"] = `Bearer ${expectedKey}`;
      } else if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      
      // Forward cookies to bypass Vercel Preview Protection
      const cookieHeader = req.headers.get("cookie");
      if (cookieHeader) {
        headers["cookie"] = cookieHeader;
      }

      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed with status: ${res.status}`);
      }
      return res.json();
    };

    console.log("[Daily Briefing] Fetching summaries in parallel...");

    // Execute fetches in parallel with Promise.allSettled
    const [gmailResult, calendarResult, sheetsResult] = await Promise.allSettled([
      fetchModule("gmail"),
      fetchModule("calendar"),
      fetchModule("sheets")
    ]);

    const modules: Record<string, any> = {};
    const module_status: Record<string, string> = {};
    const summaryParts: string[] = [];

    // Process Gmail
    if (gmailResult.status === "fulfilled" && gmailResult.value) {
      const data = gmailResult.value;
      modules["gmail"] = data;
      module_status["gmail"] = data.ok ? "ok" : "error";
      if (data.summary) {
        summaryParts.push(data.summary);
      }
    } else {
      const errorStr = gmailResult.status === "rejected" ? String(gmailResult.reason) : "Unknown error";
      console.error("[Daily Briefing] Gmail module failed:", errorStr);
      modules["gmail"] = { ok: false, error: errorStr };
      module_status["gmail"] = "error";
    }

    // Process Calendar
    if (calendarResult.status === "fulfilled" && calendarResult.value) {
      const data = calendarResult.value;
      modules["calendar"] = data;
      module_status["calendar"] = data.ok ? "ok" : "error";
      if (data.summary) {
        summaryParts.push(data.summary);
      }
    } else {
      const errorStr = calendarResult.status === "rejected" ? String(calendarResult.reason) : "Unknown error";
      console.error("[Daily Briefing] Calendar module failed:", errorStr);
      modules["calendar"] = { ok: false, error: errorStr };
      module_status["calendar"] = "error";
    }

    // Process Sheets
    if (sheetsResult.status === "fulfilled" && sheetsResult.value) {
      const data = sheetsResult.value;
      modules["sheets"] = data;
      module_status["sheets"] = data.ok ? "ok" : "error";
      if (data.summary) {
        summaryParts.push(data.summary);
      }
    } else {
      const errorStr = sheetsResult.status === "rejected" ? String(sheetsResult.reason) : "Unknown error";
      console.error("[Daily Briefing] Sheets module failed:", errorStr);
      modules["sheets"] = { ok: false, error: errorStr };
      module_status["sheets"] = "error";
    }

    // Construct final human summary
    let finalSummary = "";
    if (summaryParts.length > 0) {
      finalSummary = `¡Hola! Aquí tienes tu resumen diario: ${summaryParts.join(" ")}`;
    } else {
      finalSummary = "No se ha podido conectar con ninguna de tus integraciones para generar el resumen de hoy.";
    }

    return NextResponse.json({
      ok: true,
      summary: finalSummary,
      modules,
      module_status
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/daily-briefing] Fatal Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}
