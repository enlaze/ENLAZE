import Link from 'next/link';

export const metadata = {
  title: 'Security | ENLAZE',
  description: 'Security and infrastructure information for ENLAZE',
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-[var(--color-navy-900)] text-[var(--color-navy-50)]">
      {/* Header */}
      <header className="border-b border-[var(--color-navy-800)]">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-[var(--color-brand-green)]">
              ENLAZE
            </Link>
            <Link
              href="/"
              className="text-sm text-[var(--color-navy-50)] hover:text-[var(--color-brand-green)] transition-colors"
            >
              ← Volver
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto py-12 px-6">
        <article className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
              Seguridad
            </h1>
            <p className="text-[var(--color-navy-50)] opacity-75">
              Última actualización: Abril 2026
            </p>
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Infraestructura
            </h2>
            <p className="text-[var(--color-navy-50)]">
              ENLAZE está construida sobre una infraestructura moderna y segura:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Base de Datos:</strong> Supabase (PostgreSQL gestionado)
              </li>
              <li>
                <strong>Hosting:</strong> Vercel (infraestructura global con CDN)
              </li>
              <li>
                <strong>Inteligencia Artificial:</strong> Anthropic (modelos de IA)
              </li>
              <li>
                <strong>Email:</strong> Resend (plataforma de email transaccional)
              </li>
            </ul>
            <p className="text-[var(--color-navy-50)] pt-4">
              Consulta nuestra página de{' '}
              <Link
                href="/legal/subprocessors"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                subprocessors
              </Link>{' '}
              para más detalles sobre cada proveedor.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Cifrado
            </h2>

            <div className="space-y-3 text-[var(--color-navy-50)]">
              <div>
                <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
                  En Tránsito
                </h3>
                <p>
                  Todos los datos en tránsito están cifrados usando TLS 1.3, el estándar
                  de seguridad más moderno. ENLAZE requiere HTTPS para todas las conexiones
                  y rechaza conexiones no seguras.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
                  En Reposo
                </h3>
                <p>
                  Los datos almacenados en nuestra base de datos están cifrados usando
                  AES-256, un cifrado de nivel militar. Las claves de cifrado se gestionan
                  mediante sistemas de gestión de secretos.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
                  Contraseñas
                </h3>
                <p>
                  Las contraseñas de usuario se cifran usando bcrypt con factor de coste 12,
                  haciendo prácticamente imposible su recuperación incluso si la base de datos
                  es comprometida.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Autenticación y Autorización
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Autenticación:</strong> Supabase Auth con soporte para email/contraseña,
                OAuth y autenticación sin contraseña
              </li>
              <li>
                <strong>Sesiones:</strong> JWT (JSON Web Tokens) con expiración automática
              </li>
              <li>
                <strong>Autorización:</strong> Row Level Security (RLS) en la base de datos
                para garantizar que cada usuario solo ve sus datos
              </li>
              <li>
                <strong>RBAC:</strong> Control de acceso basado en roles para funcionalidades
                administrativas
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Row Level Security (RLS)
            </h2>
            <p className="text-[var(--color-navy-50)]">
              Todas las tablas en nuestra base de datos PostgreSQL tienen políticas de
              Row Level Security habilitadas. Esto significa que la base de datos misma
              garantiza que cada usuario solo puede acceder a sus propios datos, incluso
              si alguien logra acceso directo a la base de datos.
            </p>
            <p className="text-[var(--color-navy-50)] pt-4">
              Esta es una medida de seguridad en capas que proporciona protección adicional
              más allá de la lógica de aplicación.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Backups y Recuperación ante Desastres
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Backups Diarios:</strong> Se realizan backups automáticos diarios
                de toda la base de datos
              </li>
              <li>
                <strong>Redundancia Geográfica:</strong> Los backups se almacenan en
                múltiples ubicaciones para evitar pérdida de datos
              </li>
              <li>
                <strong>Cifrado:</strong> Todos los backups están cifrados en reposo
              </li>
              <li>
                <strong>Pruebas Regulares:</strong> Probamos regularmente la capacidad
                de restaurar desde backups
              </li>
              <li>
                <strong>Tiempo de Recuperación:</strong> Objetivo de recuperación (RTO)
                de menos de 4 horas
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Monitorización y Detección de Amenazas
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Monitorización 24/7:</strong> Nuestros sistemas están monitorizados
                continuamente para detectar anomalías
              </li>
              <li>
                <strong>Alertas Automáticas:</strong> Se disparan alertas para eventos
                sospechosos o patrones inusuales
              </li>
              <li>
                <strong>Logs Auditables:</strong> Todos los accesos y cambios se registran
                para auditoría
              </li>
              <li>
                <strong>SIEM:</strong> Utilizamos sistemas de información y gestión de
                eventos (SIEM) para análisis avanzado
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Pruebas de Seguridad
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Pruebas de Penetración:</strong> Realizamos pruebas de penetración
                regulares por terceros independientes
              </li>
              <li>
                <strong>Escaneo de Vulnerabilidades:</strong> Escaneo automatizado
                continuo de vulnerabilidades conocidas
              </li>
              <li>
                <strong>Auditorías de Código:</strong> Revisiones de seguridad regulares
                del código fuente
              </li>
              <li>
                <strong>Gestión de Dependencias:</strong> Mantenemos todas las dependencias
                actualizadas y vigilamos alertas de seguridad
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Respuesta ante Incidentes
            </h2>
            <p className="text-[var(--color-navy-50)]">
              ENLAZE tiene un plan documentado de respuesta ante incidentes de seguridad:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Detección:</strong> Identificación rápida de incidentes mediante
                monitorización
              </li>
              <li>
                <strong>Análisis:</strong> Determinación del alcance y causa del incidente
              </li>
              <li>
                <strong>Contención:</strong> Aislamiento del sistema afectado para
                evitar mayor propagación
              </li>
              <li>
                <strong>Remediación:</strong> Aplicación de parches y correcciones
              </li>
              <li>
                <strong>Notificación:</strong> Información a usuarios afectados en plazo
                de 48 horas (conforme a RGPD)
              </li>
              <li>
                <strong>Revisión Post-Incidente:</strong> Análisis para prevenir
                incidentes similares
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Control de Acceso
            </h2>
            <p className="text-[var(--color-navy-50)]">
              El acceso a sistemas críticos está restringido según los principios de
              menor privilegio:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>Autenticación Multifactor (MFA):</strong> Requerido para acceso
                administrativo
              </li>
              <li>
                <strong>Auditoría de Acceso:</strong> Todos los accesos son registrados
                y auditables
              </li>
              <li>
                <strong>Principio de Menor Privilegio:</strong> Los empleados tienen solo
                los permisos necesarios para su rol
              </li>
              <li>
                <strong>Rotación de Credenciales:</strong> Las credenciales se rotan
                regularmente
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Conformidad y Certificaciones
            </h2>
            <p className="text-[var(--color-navy-50)]">
              ENLAZE se esfuerza por cumplir con los más altos estándares:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <strong>RGPD:</strong> Cumplimiento total del Reglamento (UE) 2016/679
              </li>
              <li>
                <strong>LOPDGDD:</strong> Cumplimiento de la Ley Orgánica 3/2018
              </li>
              <li>
                <strong>SOC 2 Type II:</strong> Auditado por terceros (mediante Supabase
                y Vercel)
              </li>
              <li>
                <strong>ISO 27001:</strong> Objetivo de certificación para el próximo año
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Políticas de Seguridad
            </h2>
            <p className="text-[var(--color-navy-50)]">
              Consulta nuestras políticas de privacidad y seguridad para más información:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>
                <Link
                  href="/legal/privacy"
                  className="text-[var(--color-brand-green)] hover:underline"
                >
                  Política de Privacidad
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/cookies"
                  className="text-[var(--color-brand-green)] hover:underline"
                >
                  Política de Cookies
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/dpa"
                  className="text-[var(--color-brand-green)] hover:underline"
                >
                  Data Processing Agreement (DPA)
                </Link>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Divulgación Responsable (Responsible Disclosure)
            </h2>
            <p className="text-[var(--color-navy-50)]">
              Si descubres una vulnerabilidad de seguridad en ENLAZE, te pedimos que nos
              la reportes responsablemente en lugar de divulgarla públicamente.
            </p>
            <p className="text-[var(--color-navy-50)] pt-4">
              <strong>Contacto de Seguridad:</strong>{' '}
              <a
                href="mailto:security@enlaze.app"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                security@enlaze.app
              </a>
            </p>
            <p className="text-[var(--color-navy-50)] pt-4">
              Por favor proporciona:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
              <li>Descripción detallada de la vulnerabilidad</li>
              <li>Pasos para reproducir el problema</li>
              <li>Impacto potencial</li>
              <li>Tu información de contacto</li>
            </ul>
            <p className="text-[var(--color-navy-50)] pt-4">
              Nos comprometeemos a responder en el plazo de 48 horas y a trabajar contigo
              para resolver el problema de forma responsable.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
              Preguntas sobre Seguridad
            </h2>
            <p className="text-[var(--color-navy-50)]">
              Si tienes preguntas sobre la seguridad de ENLAZE, contáctanos:
            </p>
            <p className="text-[var(--color-navy-50)]">
              <strong>Email:</strong>{' '}
              <a
                href="mailto:security@enlaze.app"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                security@enlaze.app
              </a>
            </p>
          </section>

          <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
            <p>Última actualización: Abril 2026</p>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--color-navy-800)] mt-16">
        <div className="max-w-3xl mx-auto px-6 py-8 text-center text-sm text-[var(--color-navy-50)] opacity-75">
          <p>&copy; 2026 ENLAZE. Todos los derechos reservados.</p>
          <div className="mt-4 flex gap-6 justify-center text-xs">
            <Link href="/legal/aviso-legal" className="hover:text-[var(--color-brand-green)]">
              Aviso Legal
            </Link>
            <Link href="/legal/privacy" className="hover:text-[var(--color-brand-green)]">
              Privacidad
            </Link>
            <Link href="/legal/cookies" className="hover:text-[var(--color-brand-green)]">
              Cookies
            </Link>
            <Link href="/legal/terms" className="hover:text-[var(--color-brand-green)]">
              Términos
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
