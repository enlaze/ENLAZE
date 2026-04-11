export const metadata = {
  title: 'Política de Cookies | ENLAZE',
  description: 'Política de cookies de ENLAZE',
};

export default function CookiesPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
          Política de Cookies
        </h1>
        <p className="text-[var(--color-navy-50)] opacity-75">
          Última actualización: Abril 2026
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          1. ¿Qué son las Cookies?
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Las cookies son pequeños ficheros de texto que se almacenan en tu dispositivo
          (ordenador, móvil, tablet) cuando visitas un sitio web. Se utilizan para recordar
          información sobre tu navegación y preferencias.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          2. Tipos de Cookies que Utilizamos
        </h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--color-brand-green)] mb-2">
              Cookies Técnicas (Necesarias)
            </h3>
            <p className="text-[var(--color-navy-50)]">
              Indispensables para el funcionamiento del sitio web. Se instalan automáticamente
              sin necesidad de consentimiento previo. Incluyen autenticación de sesión,
              preferencias de idioma y configuración de seguridad.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[var(--color-brand-green)] mb-2">
              Cookies Analíticas
            </h3>
            <p className="text-[var(--color-navy-50)]">
              Nos permiten entender cómo usas el sitio web, cuáles son las páginas más
              visitadas, y detectar errores. Requieren consentimiento. Los datos se almacenan
              de forma anonimizada.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[var(--color-brand-green)] mb-2">
              Cookies de Preferencias
            </h3>
            <p className="text-[var(--color-navy-50)]">
              Guardan tus preferencias de uso, como el tema (oscuro/claro), idioma elegido y
              otras configuraciones personalizadas.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[var(--color-brand-green)] mb-2">
              Cookies de Marketing
            </h3>
            <p className="text-[var(--color-navy-50)]">
              Utilizadas para seguimiento de campañas publicitarias y remarketing. Requieren
              consentimiento expreso.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          3. Cookies Utilizadas
        </h2>
        <p className="text-[var(--color-navy-50)] mb-4">
          A continuación se detalla un listado de las cookies que utilizamos:
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[var(--color-navy-50)] border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-navy-800)]">
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Nombre
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Proveedor
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Tipo
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Finalidad
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">sb-auth-token</td>
                <td className="py-3 px-2">ENLAZE / Supabase</td>
                <td className="py-3 px-2">Técnica</td>
                <td className="py-3 px-2">Autenticación de sesión</td>
                <td className="py-3 px-2">Sesión</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">sb-refresh-token</td>
                <td className="py-3 px-2">ENLAZE / Supabase</td>
                <td className="py-3 px-2">Técnica</td>
                <td className="py-3 px-2">Renovación de sesión</td>
                <td className="py-3 px-2">7 días</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">enlaze-theme</td>
                <td className="py-3 px-2">ENLAZE</td>
                <td className="py-3 px-2">Preferencias</td>
                <td className="py-3 px-2">Preferencia de tema</td>
                <td className="py-3 px-2">1 año</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">enlaze-language</td>
                <td className="py-3 px-2">ENLAZE</td>
                <td className="py-3 px-2">Preferencias</td>
                <td className="py-3 px-2">Preferencia de idioma</td>
                <td className="py-3 px-2">1 año</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">_ga, _ga_*</td>
                <td className="py-3 px-2">Google Analytics</td>
                <td className="py-3 px-2">Analítica</td>
                <td className="py-3 px-2">Análisis de uso</td>
                <td className="py-3 px-2">2 años</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          4. Cómo Gestionar Cookies
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Tienes control total sobre las cookies en tu navegador:
        </p>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              Mediante el banner de consentimiento
            </h3>
            <p>
              Al visitar nuestro sitio, te mostraremos un banner donde puedes aceptar, rechazar
              o personalizar qué cookies permitir.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              Mediante tu navegador
            </h3>
            <p>
              Puedes configurar tu navegador para:
            </p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>Bloquear todas las cookies</li>
              <li>Permitir solo cookies de ciertos sitios</li>
              <li>Eliminar cookies al cerrar el navegador</li>
            </ul>
            <p className="text-sm mt-2">
              Ten en cuenta que bloquear cookies necesarias puede afectar el funcionamiento del
              sitio.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              Herramientas de terceros
            </h3>
            <p>
              Puedes usar servicios como{' '}
              <a
                href="https://www.allaboutcookies.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                AllAboutCookies
              </a>{' '}
              para gestionar cookies de múltiples sitios.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          5. Cookies de Terceros
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Algunos proveedores de servicios (como Google Analytics y Supabase) pueden establecer
          sus propias cookies. Consulta sus políticas de privacidad para más información:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-green)] hover:underline"
            >
              Google Privacy Policy
            </a>
          </li>
          <li>
            <a
              href="https://supabase.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-green)] hover:underline"
            >
              Supabase Privacy Policy
            </a>
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          6. Consentimiento
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El consentimiento para el uso de cookies no necesarias será solicitado antes de su
          instalación. Puedes cambiar tu consentimiento en cualquier momento mediante el
          banner de cookies disponible en la plataforma.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          7. Contacto
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Si tienes preguntas sobre nuestro uso de cookies, contacta a{' '}
          <a
            href="mailto:privacy@enlaze.app"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            privacy@enlaze.app
          </a>
        </p>
      </section>

      <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
        <p>Última actualización: Abril 2026</p>
      </div>
    </article>
  );
}
