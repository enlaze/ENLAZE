/** Ruta heredada: las facturas recibidas se gestionan en el hub. */
import { redirect } from "next/navigation";

export default async function ReceivedInvoicesRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { project } = await searchParams;
  const projectId = Array.isArray(project) ? project[0] : project;
  redirect(projectId
    ? `/dashboard/facturacion?tab=recibidas&project=${encodeURIComponent(projectId)}`
    : "/dashboard/facturacion?tab=recibidas");
}
