"use client";

import PageHeader from "@/components/ui/page-header";
import InfoFlipCard from "@/components/ui/InfoFlipCard";
import WhatsAppSurface from "@/components/whatsapp/WhatsAppSurface";

export default function MessagesPage() {
  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Envía, programa y automatiza mensajes a tus clientes"
        titleAdornment={
          <InfoFlipCard
            label="Información sobre WhatsApp"
            what="Todos tus mensajes de WhatsApp con clientes en un solo sitio, directamente desde ENLAZE. Eliges a quién escribes, qué les dices y cuándo sale — con la vista previa de cómo lo recibe cada cliente."
            howTo="Para no dejar ningún mensaje sin contestar ni repetir el mismo recordatorio cliente por cliente. Filtras por presupuesto pendiente o factura vencida, escribes una vez con variables como {nombre} o {importe}, y cada uno recibe su versión."
          />
        }
      />
      <WhatsAppSurface />
    </>
  );
}
