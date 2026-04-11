export const metadata = {
  title: 'Data Processing Agreement | ENLAZE',
  description: 'DPA - Data Processing Agreement for ENLAZE B2B clients',
};

export default function DPAPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
          Data Processing Agreement (DPA)
        </h1>
        <p className="text-[var(--color-navy-50)] opacity-75">
          Última actualización: Abril 2026
        </p>
      </div>

      <div className="bg-[var(--color-navy-800)] border border-[var(--color-navy-700)] rounded-lg p-4 text-[var(--color-navy-50)]">
        <p className="text-sm">
          This DPA is incorporated by reference into the Terms of Service and applies when
          ENLAZE acts as a Data Processor on behalf of a Data Controller. It complies with
          Article 28 of the GDPR (Regulation EU 2016/679).
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          1. Objeto (Subject Matter)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Este Acuerdo de Procesamiento de Datos (DPA) regula el procesamiento de datos
          personales por parte de ENLAZE TECH S.L. (Encargado del Tratamiento) en nombre del
          Cliente (Responsable del Tratamiento), de conformidad con el Artículo 28 del RGPD.
        </p>
        <p className="text-[var(--color-navy-50)]">
          El DPA se aplica únicamente en la medida en que el servicio implique el procesamiento
          de datos personales sujetos a la normativa de protección de datos.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          2. Datos Tratados (Categories of Personal Data)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El Encargado procesará las siguientes categorías de datos:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Datos de identificación (nombre, email, teléfono)</li>
          <li>Datos de contacto y dirección</li>
          <li>Identificadores de cuenta y credenciales de autenticación</li>
          <li>Datos de uso y actividad en la plataforma</li>
          <li>Datos de facturación</li>
          <li>Datos comerciales y de empresa proporcionados por el Cliente</li>
          <li>Datos técnicos (dirección IP, registro de acceso, cookies)</li>
          <li>Cualquier otro dato personal que el Cliente proporcione voluntariamente</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          3. Categorías de Interesados (Categories of Data Subjects)
        </h2>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Empleados del Cliente</li>
          <li>Clientes del Cliente</li>
          <li>Socios comerciales del Cliente</li>
          <li>Usuarios finales autorizados del servicio</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          4. Duración (Duration)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El presente DPA es válido durante todo el período en que ENLAZE proporciona servicios
          al Cliente y continúa hasta la eliminación o devolución de todos los datos personales,
          como se especifica en la Sección 11.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          5. Naturaleza y Propósito del Tratamiento (Processing Purpose)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El Encargado procesará datos personales exclusivamente con el propósito de:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Proporcionar el servicio SaaS de gestión empresarial</li>
          <li>Cumplir obligaciones contractuales y legales</li>
          <li>Mantener la seguridad y disponibilidad del servicio</li>
          <li>Realizar análisis técnicos y mejoras del servicio</li>
        </ul>
        <p className="text-[var(--color-navy-50)] pt-4">
          El Encargado no procesará datos para propósitos propios sin consentimiento explícito
          del Responsable.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          6. Obligaciones del Encargado
        </h2>

        <div className="space-y-3 text-[var(--color-navy-50)]">
          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.1 Instrucciones del Responsable
            </h3>
            <p>
              El Encargado procesará datos personales únicamente bajo instrucciones
              documentadas del Responsable y no procesará datos para propósitos adicionales
              sin consentimiento previo.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.2 Confidencialidad
            </h3>
            <p>
              El Encargado garantiza que el personal autorizado ha asumido compromisos de
              confidencialidad o está sujeto a una obligación legal de confidencialidad.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.3 Medidas de Seguridad
            </h3>
            <p>
              El Encargado implementará medidas técnicas y organizativas apropiadas para
              garantizar un nivel de seguridad adecuado al riesgo, incluyendo: cifrado,
              autenticación, control de accesos, pruebas de seguridad y auditorías regulares.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.4 Subprocesadores
            </h3>
            <p>
              El Encargado obtendrá consentimiento previo del Responsable antes de autorizar
              subprocesadores. Se mantendrá una lista actualizada de subprocesadores
              autorizados disponible en{' '}
              <a
                href="/legal/subprocessors"
                className="text-[var(--color-brand-green)] hover:underline"
              >
                /legal/subprocessors
              </a>
              .
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.5 Asistencia
            </h3>
            <p>
              El Encargado asistirá al Responsable en el cumplimiento de sus obligaciones,
              incluyendo: solicitudes de derechos ARCO, análisis de impacto en privacidad,
              y consultas previas a la autoridad supervisora.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--color-brand-green)] mb-1">
              6.6 Auditorías y Certificaciones
            </h3>
            <p>
              El Encargado permitirá auditorías razonables del Responsable o sus auditores
              designados. ENLAZE mantiene certificaciones de seguridad relevantes (ISO 27001,
              SOC 2, etc.).
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          7. Subencargados Autorizados (Authorized Sub-processors)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE ha autorizado los siguientes subprocesadores:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[var(--color-navy-50)] border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-navy-800)]">
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Subprocesador
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Función
                </th>
                <th className="text-left py-3 px-2 font-semibold text-[var(--color-brand-green)]">
                  Ubicación
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">Supabase Inc.</td>
                <td className="py-3 px-2">Base de datos y autenticación</td>
                <td className="py-3 px-2">EE.UU. (SCCs)</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">Vercel Inc.</td>
                <td className="py-3 px-2">Hosting y CDN</td>
                <td className="py-3 px-2">EE.UU. (SCCs)</td>
              </tr>
              <tr className="border-b border-[var(--color-navy-800)]">
                <td className="py-3 px-2">Anthropic PBC</td>
                <td className="py-3 px-2">Inteligencia Artificial</td>
                <td className="py-3 px-2">EE.UU. (SCCs)</td>
              </tr>
              <tr>
                <td className="py-3 px-2">Resend Inc.</td>
                <td className="py-3 px-2">Envío de correos electrónicos</td>
                <td className="py-3 px-2">EE.UU. (SCCs)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[var(--color-navy-50)] pt-4 text-sm">
          Consulta la página de{' '}
          <a
            href="/legal/subprocessors"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            subprocesadores
          </a>{' '}
          para más detalles y contacto.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          8. Medidas de Seguridad (Security Measures)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE implementa las siguientes medidas técnicas y organizativas:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Cifrado en tránsito (TLS 1.3) y en reposo (AES-256)</li>
          <li>Autenticación de usuarios (bcrypt hashing y JWT)</li>
          <li>Row Level Security (RLS) en la base de datos</li>
          <li>Control de accesos basado en roles (RBAC)</li>
          <li>Backups diarios y recuperación ante desastres</li>
          <li>Monitorización y alertas de seguridad 24/7</li>
          <li>Pruebas de penetración regulares</li>
          <li>Escaneo de vulnerabilidades automatizado</li>
          <li>Auditorías de seguridad y cumplimiento</li>
          <li>Documentación de incidentes y plan de respuesta</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          9. Transferencias Internacionales (International Transfers)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Como algunos subprocesadores están ubicados en EE.UU., ENLAZE implementa
          Cláusulas Contractuales Estándar (SCC) aprobadas por la Comisión Europea conforme
          al Artículo 46 del RGPD para garantizar un nivel adecuado de protección.
        </p>
        <p className="text-[var(--color-navy-50)]">
          El Responsable acepta estas transferencias al contratar el servicio.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          10. Notificación de Brechas (Breach Notification)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El Encargado notificará al Responsable sin demora injustificada (no más tarde de
          48 horas) de cualquier sospecha de violación de seguridad de datos, incluyendo:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Naturaleza y alcance de la violación</li>
          <li>Categorías y número aproximado de interesados afectados</li>
          <li>Categorías de datos personales afectados</li>
          <li>Medidas correctivas implementadas</li>
          <li>Punto de contacto para más información</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          11. Devolución y Supresión de Datos (Data Return & Deletion)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Tras la terminación del servicio:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>
            El Responsable tendrá 30 días para descargar sus datos desde la plataforma
          </li>
          <li>
            Tras este período, ENLAZE eliminará todos los datos personales de sus sistemas
          </li>
          <li>
            Se mantendrán copias de seguridad encriptadas según la política de retención
            (máximo 90 días)
          </li>
          <li>
            El Encargado proporcionará certificación de eliminación bajo solicitud
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          12. Derechos de los Interesados (Data Subject Rights)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El Encargado asistirá al Responsable en la implementación de los derechos ARCO+:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Derecho de acceso (Artículo 15 RGPD)</li>
          <li>Derecho de rectificación (Artículo 16 RGPD)</li>
          <li>Derecho de supresión (Artículo 17 RGPD)</li>
          <li>Derecho de limitación (Artículo 18 RGPD)</li>
          <li>Derecho de portabilidad (Artículo 20 RGPD)</li>
          <li>Derecho de oposición (Artículo 21 RGPD)</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          13. Documentación de Cumplimiento
        </h2>
        <p className="text-[var(--color-navy-50)]">
          ENLAZE proporciona:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Registro de actividades de procesamiento</li>
          <li>Registros de auditoría de acceso de datos</li>
          <li>Evaluaciones de Impacto en la Protección de Datos (DPIA) si es necesario</li>
          <li>Certificados de seguridad y conformidad</li>
          <li>Informes de incidentes cuando corresponda</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          14. Legislación Aplicable
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Este DPA se rige por:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Reglamento (UE) 2016/679 (RGPD)</li>
          <li>Ley Orgánica 3/2018 (LOPDGDD)</li>
          <li>Legislación española aplicable</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          15. Contacto y Consultas
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Para consultas sobre este DPA:
        </p>
        <p className="text-[var(--color-navy-50)]">
          <strong>Email:</strong>{' '}
          <a
            href="mailto:dpo@enlaze.app"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            dpo@enlaze.app
          </a>
        </p>
      </section>

      <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
        <p>Última actualización: Abril 2026</p>
      </div>
    </article>
  );
}
