export const metadata = {
  title: 'Aviso Legal | ENLAZE',
  description: 'Aviso legal de ENLAZE',
};

export default function AvisoLegalPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
          Aviso Legal
        </h1>
        <p className="text-[var(--color-navy-50)] opacity-75">
          Última actualización: Abril 2026
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Identificación del Titular
        </h2>
        <div className="space-y-3 text-[var(--color-navy-50)]">
          <p>
            <strong>Nombre o Razón Social:</strong> ENLAZE TECH S.L.
          </p>
          <p>
            <strong>NIF:</strong> B-XXXXXXXX
          </p>
          <p>
            <strong>Domicilio:</strong> Alicante, España
          </p>
          <p>
            <strong>Email:</strong>{' '}
            <a
              href="mailto:legal@enlaze.app"
              className="text-[var(--color-brand-green)] hover:underline"
            >
              legal@enlaze.app
            </a>
          </p>
          <p>
            <strong>Registro Mercantil:</strong> Registro Mercantil de Alicante, Tomo XX,
            Folio XXX
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Objeto del Sitio Web
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El presente sitio web tiene como objeto proporcionar a los usuarios una plataforma
          de software como servicio (SaaS) para la gestión empresarial. La información y
          servicios contenidos en este sitio se ofrecen &quot;tal cual&quot;, sin garantías
          de ningún tipo, salvo las expresamente establecidas en estos términos.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Propiedad Intelectual
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Todos los contenidos del sitio web, incluidos pero no limitados a textos, gráficos,
          logotipos, imágenes, iconos, software, código fuente y demás elementos, son
          propiedad de ENLAZE TECH S.L. o de terceros que han autorizado su uso.
        </p>
        <p className="text-[var(--color-navy-50)]">
          Se prohíbe la reproducción, distribución, transmisión, transformación, comunicación
          pública o cualquier otro uso de los contenidos sin la previa autorización escrita
          de ENLAZE TECH S.L., salvo que sea expresamente permitido en estos términos.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Responsabilidad
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE TECH S.L. no se responsabiliza de:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>
            Errores, omisiones o fallos en el funcionamiento del sitio web o servicios.
          </li>
          <li>
            Daños y perjuicios causados por la falta de disponibilidad del sitio web.
          </li>
          <li>
            Acceso no autorizado a los sistemas de ENLAZE.
          </li>
          <li>
            Pérdida de datos o información derivada del uso del servicio.
          </li>
          <li>
            Contenido generado o enviado por usuarios del servicio.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Enlaces Externos
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El sitio web puede contener enlaces a sitios web de terceros. ENLAZE TECH S.L. no
          se responsabiliza del contenido, exactitud, disponibilidad o prácticas de privacidad
          de estos sitios externos. El acceso a enlaces externos se realiza bajo la
          responsabilidad exclusiva del usuario.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Legislación Aplicable
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Este Aviso Legal se rige por la legislación española, en particular:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Ley 34/1988, de 11 de noviembre, sobre Publicidad y Servicios en la Sociedad de
            la Información y del Comercio Electrónico (LSSI-CE)</li>
          <li>Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y
            garantía de los derechos digitales (LOPDGDD)</li>
          <li>Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo (RGPD)</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Jurisdicción
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Para cualquier disputa relacionada con este sitio web o servicios, serán competentes
          los juzgados y tribunales de Alicante, España.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Contacto
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Para consultas sobre este Aviso Legal, puedes contactarnos en{' '}
          <a
            href="mailto:legal@enlaze.app"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            legal@enlaze.app
          </a>
        </p>
      </section>

      <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
        <p>Última actualización: Abril 2026</p>
      </div>
    </article>
  );
}
