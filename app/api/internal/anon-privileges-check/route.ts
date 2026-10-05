import { bearerMatchesToken } from "@/lib/price-sync-auth";
import { getServiceRoleClient } from "@/lib/supabase-service-role";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authorized = bearerMatchesToken(
    request.headers.get("authorization") ?? "",
    [process.env.ANON_PRIVILEGES_CHECK_TOKEN],
  );
  if (!authorized) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: noStore });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return Response.json({ error: "Centinela no configurado" }, { status: 503, headers: noStore });
  }

  const { data, error } = await supabase.rpc("anon_privileges_sentinel");
  if (error) {
    console.error("[anon-privileges-check] RPC fallida", error.code);
    return Response.json({ error: "No se pudo consultar el centinela" }, { status: 503, headers: noStore });
  }

  const countValue = Array.isArray(data) ? data[0]?.reaparecidas : undefined;
  const validCount = (typeof countValue === "number" && Number.isSafeInteger(countValue) && countValue >= 0)
    || (typeof countValue === "string" && /^(0|[1-9]\d*)$/.test(countValue)
      && Number.isSafeInteger(Number(countValue)));
  if (!Array.isArray(data) || data.length !== 1
      || typeof data[0]?.veredicto !== "string"
      || typeof data[0]?.nombres !== "string" || !validCount) {
    return Response.json({ error: "Respuesta inesperada del centinela" }, { status: 502, headers: noStore });
  }

  return Response.json({
    verdict: data[0].veredicto,
    reaparecidas: Number(countValue),
    nombres: data[0].nombres,
  }, { headers: noStore });
}
