import ClientDetail from "@/components/clientes/ClientDetail";

/* Componente de servidor: lo único que hace es resolver el segmento dinámico
   —en esta versión de Next `params` es una promesa— y pasárselo a la ficha,
   que sí es cliente porque lee de Supabase en el navegador con la sesión del
   usuario. Este fichero no exporta nada más: los ficheros de ruta no lo
   admiten (rompe `tsc --noEmit` aunque `npm run build` pase). */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientDetail clientId={id} />;
}
