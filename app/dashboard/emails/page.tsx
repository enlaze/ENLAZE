"use client";

import PageHeader from "@/components/ui/page-header";
import InfoFlipCard from "@/components/ui/InfoFlipCard";
import EmailSurface from "@/components/email/EmailSurface";

export default function EmailsPage() {
  return (
    <>
      <PageHeader
        title="Emails"
        description="Tu bandeja de Gmail clasificada por importancia y el envío automatizado a clientes"
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Emails"
            what="Aquí ves tu bandeja de Gmail clasificada por importancia y preparas envíos a tus clientes: eliges a quién escribes, qué les dices y cuándo sale, con la vista previa de cómo llega a su bandeja."
            howTo="En 'Bandeja' el agente ordena tus correos entrantes para que no se te escape nada de clientes o proveedores. En 'Nuevo envío' filtras por presupuesto pendiente o factura vencida, escribes una vez con variables como {nombre} o {importe}, y cada cliente recibe su versión."
          />
        }
      />
      <EmailSurface />
    </>
  );
}
