import { NextRequest, NextResponse } from "next/server";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const body = await req.json();
    const { to, subject, body: emailBody, threadId } = body;

    if (!to || !subject || !emailBody) {
      return NextResponse.json({ error: "Missing required fields: to, subject, body" }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(supabase, userId, "gmail");
    if (!accessToken) {
      return NextResponse.json({ error: "Gmail token missing or expired" }, { status: 401 });
    }

    // Format email RFC 2822
    const messageStr = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      emailBody
    ].join("\n");

    // Base64url encode
    const encodedMessage = Buffer.from(messageStr)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const draftBody: any = {
      message: {
        raw: encodedMessage
      }
    };

    if (threadId) {
      draftBody.message.threadId = threadId;
    }

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(draftBody)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gmail API Error: ${res.status} ${res.statusText} - ${errorText}`);
    }

    const data = await res.json();

    return NextResponse.json({
      ok: true,
      draft_id: data.id,
      message: "Borrador creado correctamente"
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/gmail/action/create-draft] Error:", message);
    return NextResponse.json({ error: "Internal server error", detail: message }, { status: 500 });
  }
}
