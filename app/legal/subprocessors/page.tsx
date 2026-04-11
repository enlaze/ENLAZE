export const metadata = {
  title: 'Subprocessors | ENLAZE',
  description: 'List of authorized subprocessors and data processors used by ENLAZE',
};

export default function SubprocessorsPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
          Subprocessors & Data Processors
        </h1>
        <p className="text-[var(--color-navy-50)] opacity-75">
          Última actualización: Abril 2026
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Overview
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE utiliza subprocesadores autorizados para proporcionar servicios de calidad.
          A continuación se detalla el listado completo de subprocesadores que tratarán datos
          personales en nombre de ENLAZE.
        </p>
        <p className="text-[var(--color-navy-50)]">
          Todos los subprocesadores han sido evaluados para cumplir nuestros estándares de
          seguridad y privacidad. Esta lista se actualiza según sea necesario.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Authorized Subprocessors
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[var(--color-navy-50)] border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-navy-800)]">
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Subprocesador
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Servicio
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  País
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Política de Privacidad
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">
                  <strong>Supabase Inc.</strong>
                </td>
                <td className="py-3 px-2">Base de datos relacional, autenticación y API</td>
                <td className="py-3 px-2">EE.UU.</td>
                <td className="py-3 px-2">
                  <a
                    href="https://supabase.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] hover:underline"
                  >
                    supabase.com/privacy
                  </a>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">
                  <strong>Vercel Inc.</strong>
                </td>
                <td className="py-3 px-2">Hosting, deployments, CDN y analítica web</td>
                <td className="py-3 px-2">EE.UU.</td>
                <td className="py-3 px-2">
                  <a
                    href="https://vercel.com/legal/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] hover:underline"
                  >
                    vercel.com/legal/privacy-policy
                  </a>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">
                  <strong>Anthropic PBC</strong>
                </td>
                <td className="py-3 px-2">Inteligencia artificial y procesamiento de lenguaje natural</td>
                <td className="py-3 px-2">EE.UU.</td>
                <td className="py-3 px-2">
                  <a
                    href="https://www.anthropic.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] hover:underline"
                  >
                    anthropic.com/privacy
                  </a>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">
                  <strong>Resend Inc.</strong>
                </td>
                <td className="py-3 px-2">Envío de correos electrónicos transaccionales</td>
                <td className="py-3 px-2">EE.UU.</td>
                <td className="py-3 px-2">
                  <a
                    href="https://resend.com/legal/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-brand-green)] hover:underline"
                  >
                    resend.com/legal/privacy-policy
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          1. Supabase Inc.
        </h2>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Servicio</h3>
            <p>
              Plataforma de base de datos PostgreSQL con autenticación integrada y API
              en tiempo real.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Datos Procesados</h3>
            <p>
              Credenciales de usuario, datos de sesión, contenido del usuario, metadatos
              de transacciones, logs de acceso.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Garantías</h3>
            <p>
              Cláusulas Contractuales Estándar (SCC), cifrado en reposo AES-256, cifrado
              en tránsito TLS 1.3, backups diarios, cumplimiento SOC 2.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Contacto</h3>
            <p>
              <a
                href="https://supabase.com/contact"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                supabase.com/contact
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          2. Vercel Inc.
        </h2>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Servicio</h3>
            <p>
              Hosting de aplicaciones web, red de distribución de contenidos (CDN),
              deployments automatizados y analítica web.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Datos Procesados</h3>
            <p>
              Datos de tráfico web, direcciones IP de usuarios, información de navegador,
              cookies analíticas, logs de servidor.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Garantías</h3>
            <p>
              Cláusulas Contractuales Estándar (SCC), infraestructura en múltiples
              ubicaciones geográficas, protección DDoS, cifrado TLS 1.3, auditorías
              de seguridad regulares.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Contacto</h3>
            <p>
              <a
                href="https://vercel.com/help"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                vercel.com/help
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          3. Anthropic PBC
        </h2>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Servicio</h3>
            <p>
              Modelos de inteligencia artificial y procesamiento de lenguaje natural
              para mejorar funcionalidades de ENLAZE.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Datos Procesados</h3>
            <p>
              Textos, documentos y solicitudes enviadas a través de funcionalidades
              de IA. Los datos se procesan de forma anonimizada cuando es posible.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Garantías</h3>
            <p>
              Cláusulas Contractuales Estándar (SCC), política de no retención de
              datos (los datos no se utilizan para entrenar nuevos modelos sin
              consentimiento), encriptación de tránsito, auditorías de seguridad.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Contacto</h3>
            <p>
              <a
                href="https://www.anthropic.com/contact"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                anthropic.com/contact
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          4. Resend Inc.
        </h2>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Servicio</h3>
            <p>
              Plataforma especializada en envío de correos electrónicos transaccionales
              y notificaciones.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Datos Procesados</h3>
            <p>
              Direcciones de correo electrónico, contenido de emails, metadatos de
              envíos, registros de entregas y aperturas.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Garantías</h3>
            <p>
              Cláusulas Contractuales Estándar (SCC), cifrado de tránsito TLS,
              cumplimiento GDPR, protección contra spam y phishing, registros de auditoría.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">Contacto</h3>
            <p>
              <a
                href="https://resend.com/support"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                resend.com/support
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Transferencias Internacionales
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Todos los subprocesadores enumerados arriba están ubicados en EE.UU. Para
          garantizar un nivel adecuado de protección de datos personales, ENLAZE ha
          implementado Cláusulas Contractuales Estándar (SCC) aprobadas por la Comisión
          Europea conforme al Artículo 46 del Reglamento (UE) 2016/679 (RGPD).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Cambios en Subprocesadores
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE puede cambiar, añadir o remover subprocesadores en cualquier momento.
          Notificaremos a los clientes de cambios materiales con al menos 30 días de
          anticipación a través de email o mediante un aviso en la plataforma.
        </p>
        <p className="text-[var(--color-navy-50)]">
          Si no estás de acuerdo con un cambio de subprocesador, puedes solicitar la
          cancelación de tu cuenta.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          Objeciones
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Si tienes objeciones respecto a algún subprocesador, puedes contactarnos en{' '}
          <a
            href="mailto:privacy@enlaze.app"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            privacy@enlaze.app
          </a>
          . Revisaremos tu solicitud en el plazo de 10 días hábiles.
        </p>
      </section>

      <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
        <p>Última actualización: Abril 2026</p>
      </div>
    </article>
  );
}
