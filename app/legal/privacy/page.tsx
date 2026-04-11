export const metadata = {
  title: 'Política de Privacidad | ENLAZE',
  description: 'Política de privacidad y protección de datos de ENLAZE',
};

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2 text-[var(--color-brand-green)]">
          Política de Privacidad
        </h1>
        <p className="text-[var(--color-navy-50)] opacity-75">
          Última actualización: Abril 2026
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          1. Responsable del Tratamiento
        </h2>
        <div className="space-y-3 text-[var(--color-navy-50)]">
          <p>
            <strong>Nombre:</strong> ENLAZE TECH S.L.
          </p>
          <p>
            <strong>Domicilio:</strong> Alicante, España
          </p>
          <p>
            <strong>Email:</strong>{' '}
            <a
              href="mailto:privacy@enlaze.app"
              className="text-[var(--color-brand-green)] hover:underline"
            >
              privacy@enlaze.app
            </a>
          </p>
          <p>
            <strong>Responsable de Protección de Datos (DPO):</strong>{' '}
            <a
              href="mailto:dpo@enlaze.app"
              className="text-[var(--color-brand-green)] hover:underline"
            >
              dpo@enlaze.app
            </a>
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          2. Finalidades del Tratamiento
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Tratamos tus datos personales para las siguientes finalidades:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Creación y gestión de tu cuenta de usuario</li>
          <li>Provisión de servicios de gestión empresarial SaaS</li>
          <li>Comunicaciones sobre tu cuenta y servicios</li>
          <li>Mejora y optimización del servicio</li>
          <li>Cumplimiento de obligaciones legales</li>
          <li>Análisis y estadísticas de uso (anonimizadas cuando sea posible)</li>
          <li>Envío de newsletters y comunicaciones (previa consentimiento)</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          3. Legitimación
        </h2>
        <p className="text-[var(--color-navy-50)]">
          El tratamiento de tus datos se basa en:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>
            <strong>Consentimiento:</strong> Cuando expresamente lo autorices, especialmente
            para fines de marketing
          </li>
          <li>
            <strong>Ejecución de contrato:</strong> Datos necesarios para ejecutar el servicio
            que has contratado
          </li>
          <li>
            <strong>Interés legítimo:</strong> Para mejorar la seguridad y funcionamiento del
            servicio
          </li>
          <li>
            <strong>Cumplimiento legal:</strong> Cuando la ley lo requiere
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          4. Categorías de Datos Tratados
        </h2>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Datos de identificación (nombre, email, teléfono)</li>
          <li>Datos de cuenta (usuario, contraseña hasheada, fecha de registro)</li>
          <li>Datos de uso y actividad en la plataforma</li>
          <li>Datos de facturación y pago</li>
          <li>Datos relativos a tu empresa (nombre, sector, tamaño)</li>
          <li>Datos que voluntariamente proporciones en tu perfil</li>
          <li>Datos técnicos (dirección IP, tipo de navegador, cookies)</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          5. Destinatarios (Subprocesadores)
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Tus datos pueden ser compartidos con los siguientes subprocesadores:
        </p>
        <div className="space-y-3 text-[var(--color-navy-50)]">
          <p>
            <strong>Supabase Inc.:</strong> Base de datos y autenticación (EE.UU., con
            Cláusulas Contractuales Estándar)
          </p>
          <p>
            <strong>Vercel Inc.:</strong> Hosting y CDN (EE.UU., con Cláusulas Contractuales
            Estándar)
          </p>
          <p>
            <strong>Anthropic PBC:</strong> Servicios de IA (EE.UU., con Cláusulas
            Contractuales Estándar)
          </p>
          <p>
            <strong>Resend Inc.:</strong> Envío de emails (EE.UU., con Cláusulas Contractuales
            Estándar)
          </p>
        </div>
        <p className="text-[var(--color-navy-50)] pt-4">
          Consulta nuestra página de{' '}
          <a
            href="/legal/subprocessors"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            subprocesadores
          </a>{' '}
          para más información.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          6. Derechos ARCO+
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Tienes derecho a:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>
            <strong>Acceso:</strong> Obtener información sobre qué datos tenemos y cómo se
            tratan
          </li>
          <li>
            <strong>Rectificación:</strong> Corregir datos inexactos o incompletos
          </li>
          <li>
            <strong>Supresión:</strong> Solicitar la eliminación de tus datos (derecho al
            olvido)
          </li>
          <li>
            <strong>Limitación:</strong> Restringir el tratamiento de tus datos
          </li>
          <li>
            <strong>Portabilidad:</strong> Recibir tus datos en formato estructurado
          </li>
          <li>
            <strong>Oposición:</strong> Oponernte al tratamiento de tus datos
          </li>
          <li>
            <strong>Revocación del consentimiento:</strong> Retirar el consentimiento en
            cualquier momento
          </li>
        </ul>
        <p className="text-[var(--color-navy-50)] pt-4">
          Para ejercer estos derechos, contacta a{' '}
          <a
            href="mailto:privacy@enlaze.app"
            className="text-[var(--color-brand-green)] hover:underline"
          >
            privacy@enlaze.app
          </a>
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          7. Plazo de Conservación
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Conservaremos tus datos durante el tiempo necesario para:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Mantener tu cuenta activa mientras la uses</li>
          <li>Cumplir obligaciones legales y fiscales (generalmente 6 años)</li>
          <li>Resolver disputas y hacer valer nuestros derechos legales</li>
        </ul>
        <p className="text-[var(--color-navy-50)] pt-4">
          Tras el cese del servicio, conservaremos los datos durante el plazo legalmente
          requerido y, después, los suprimiremos de forma segura.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          8. Seguridad
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Implementamos medidas técnicas y organizativas para proteger tus datos:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[var(--color-navy-50)]">
          <li>Cifrado en tránsito (TLS 1.3)</li>
          <li>Cifrado en reposo (AES-256)</li>
          <li>Autenticación mediante bcrypt y JWT</li>
          <li>Row Level Security en la base de datos</li>
          <li>Backups diarios cifrados</li>
          <li>Acceso restringido y control de accesos</li>
          <li>Monitorización y auditoría de seguridad</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          9. Transferencias Internacionales
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Algunos de nuestros subprocesadores están ubicados en EE.UU. Para garantizar un
          nivel adecuado de protección, utilizamos Cláusulas Contractuales Estándar aprobadas
          por la Comisión Europea en virtud del Artículo 46 del RGPD.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          10. Cambios en esta Política
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Podemos actualizar esta política en cualquier momento. Te notificaremos de cambios
          materiales por email o mediante un aviso destacado en la plataforma. El uso continuo
          del servicio implica aceptación de los cambios.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--color-brand-green)]">
          11. Reclamaciones
        </h2>
        <p className="text-[var(--color-navy-50)]">
          Si consideras que tus derechos han sido vulnerados, tienes derecho a presentar una
          reclamación ante la Autoridad de Protección de Datos correspondiente.
        </p>
      </section>

      <div className="pt-8 border-t border-[var(--color-navy-800)] text-sm text-[var(--color-navy-50)] opacity-75">
        <p>Última actualización: Abril 2026</p>
      </div>
    </article>
  );
}
