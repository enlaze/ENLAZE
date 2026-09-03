/**
 * Ruta antigua de "Facturas recibidas".
 *
 * Redirige al hub de Facturación conservando el filtro por proveedor con el
 * que enlaza la ficha de proveedor. El detalle
 * (/dashboard/suppliers/invoices/[id]) sigue donde estaba.
 */

import { redirect } from "next/navigation";

export default async function ReceivedInvoicesRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { supplier } = await searchParams;
  const supplierId = Array.isArray(supplier) ? supplier[0] : supplier;

  redirect(
    supplierId
      ? `/dashboard/facturacion?tab=recibidas&supplier=${encodeURIComponent(supplierId)}`
      : "/dashboard/facturacion?tab=recibidas",
  );
}
