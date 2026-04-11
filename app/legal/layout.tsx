import Link from 'next/link';

export const metadata = {
  title: 'Legal',
  description: 'ENLAZE Legal Information',
};

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        {children}
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
