/**
 * Ruta antigua de "Facturas emitidas".
 *
 * El contenido vive ahora en el hub de Facturación; esta página se queda solo
 * para que no se rompan los enlaces guardados, los del Centro de control y los
 * de la búsqueda rápida. El detalle (/dashboard/issued-invoices/[id]) sigue
 * donde estaba.
 */

import { redirect } from "next/navigation";

export default function IssuedInvoicesRedirect() {
  redirect("/dashboard/facturacion?tab=emitidas");
}
