import { NextResponse } from "next/server";

// This route is deprecated. PDF generation now uses a client-side print page
// at /contabilidad-print instead of server-side Python/ReportLab.
// Keeping this route to avoid 404s on old bookmarks — it redirects to the print page.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const printUrl = new URL("/contabilidad-print", url.origin);

  // Forward all query params
  url.searchParams.forEach((value, key) => {
    printUrl.searchParams.set(key, value);
  });

  return NextResponse.redirect(printUrl.toString());
}
