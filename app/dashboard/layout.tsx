"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import { SearchCommandProvider, useSearchCommand } from "@/components/SearchCommand";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import ThemeToggle from "@/components/ThemeToggle";
import { SectorProvider, useSector } from "@/lib/sector-context";
import PriceTrackerBackgroundStatus from "@/components/PriceTrackerBackgroundStatus";
import { useToast } from "@/components/ui/toast";
import { analytics, resetAnalytics } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";
/* La lista canónica de secciones (NAV_ITEMS, iconos y reglas de filtrado) vive
   en lib/dashboard-nav.tsx: un layout.tsx no puede exportar nada propio y
   Ajustes → Personalización necesita la misma lista. */
import {
  NON_HIDEABLE_HREFS,
  SECTION_ORDER,
  resolveSectorNavItems,
} from "@/lib/dashboard-nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectorProvider>
      <SearchCommandProvider>
        <DashboardInner>{children}</DashboardInner>
      </SearchCommandProvider>
    </SectorProvider>
  );
}

/* Topbar button that opens the global command palette via the hook. */
function SearchTriggerButton() {
  const { open } = useSearchCommand();
  return (
    <div className="relative hidden max-w-md flex-1 md:block">
      <button
        type="button"
        onClick={open}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-navy-100 bg-navy-50/60 pl-3 pr-3 text-sm text-navy-400 transition-colors hover:border-navy-200 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-800"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="flex-1 text-left">Buscar clientes, presupuestos…</span>
        <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-navy-200 bg-white px-1.5 text-[10px] font-medium text-navy-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">⌘K</kbd>
      </button>
    </div>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { visibleModules, hiddenModules } = useSector();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      setLoading(false);
    };
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    analytics.userLoggedOut();
    resetAnalytics();
    setSentryUser(null);
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleResendVerificationEmail = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: user.email,
    });
    if (error) {
      console.error("Error resending email:", error);
      toast.error("No se pudo reenviar el email", {
        description: "Inténtalo de nuevo en unos segundos.",
      });
      return;
    }
    toast.success("Email de verificación reenviado", {
      description: "Revisa tu bandeja de entrada.",
    });
  };

  // Supabase marca la confirmación nativa en email_confirmed_at. Con "Confirm
  // email" activo un usuario logueado ya está confirmado, así que el banner solo
  // aparece si esa opción está desactivada en el proyecto.
  const emailVerified = Boolean(user?.email_confirmed_at);

  // Build nav items from canonical list, optionally filtered by sector visibility.
  // If the sector config returns an explicit list of modules, only those hrefs
  // (plus always-visible system items) are shown. Otherwise we show everything.
  // The sector config can also override the label per href (e.g. "Presupuestos"
  // → "Propuestas" for Servicios Profesionales).
  //
  // Encima de eso se aplica la preferencia personal (Ajustes → Personalización):
  // los hrefs de `hiddenModules` desaparecen del menú, salvo los no ocultables.
  // Ojo: esto es SOLO menú — las rutas siguen accesibles por URL directa.
  const hiddenHrefs = new Set(hiddenModules);
  const navItems = resolveSectorNavItems(visibleModules()).filter(
    (item) => NON_HIDEABLE_HREFS.has(item.href) || !hiddenHrefs.has(item.href),
  );

  // Group by section, preserving SECTION_ORDER.
  const sections = SECTION_ORDER
    .map((section) => ({
      title: section,
      items: navItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);

  // User initials for the avatar
  const initials = (() => {
    const name = user?.user_metadata?.full_name || user?.user_metadata?.name;
    if (name) {
      return name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return "EN";
  })();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50 dark:bg-zinc-950">
        <div className="text-navy-600 dark:text-zinc-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fa_280px)] font-sans dark:bg-zinc-950 dark:bg-none">
      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-navy-100 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
          {/* Logo + mobile toggle */}
          <div className="flex shrink-0 items-center gap-3 lg:w-64">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-navy-700 transition-colors lg:hidden dark:text-zinc-300"
              aria-label="Abrir menú"
            >
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Logo href="/dashboard" size={30} />
          </div>

          {/* Search trigger */}
          <SearchTriggerButton />

          <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
            {/* Theme toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <NotificationCenter />

            {/* Avatar + menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 text-sm text-navy-700 transition-colors hover:border-navy-100 hover:bg-navy-50 dark:text-zinc-300 dark:hover:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white dark:bg-zinc-900 dark:text-zinc-100">
                  {initials}
                </span>
                <span className="hidden max-w-[140px] truncate font-medium sm:block">
                  {user?.email}
                </span>
                <svg className="hidden sm:block" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
                    <div className="border-b border-navy-100 px-4 py-3 dark:border-zinc-800">
                      <p className="truncate text-xs text-navy-500 dark:text-zinc-500">Conectado como</p>
                      <p className="truncate text-sm font-medium text-navy-900 dark:text-white">{user?.email}</p>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Ajustes
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="block w-full px-4 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Sidebar overlay on mobile ──────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden dark:bg-black/60"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside
        className={`fixed bottom-0 left-0 top-[57px] z-30 w-64 transform border-r border-navy-100 bg-white transition-transform duration-200 lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-950 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="h-full overflow-y-auto px-4 py-6">
          {sections.map((group, groupIdx) => (
            <div key={group.title ?? "_top"} className={groupIdx === 0 ? "" : "mt-6"}>
              {group.title && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          group relative flex items-center gap-3 rounded-xl
                          px-3 py-2.5 text-[13.5px] font-medium
                          transition-colors duration-150
                          ${
                            active
                              ? "bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-green-light"
                              : "text-navy-700 hover:bg-navy-100 hover:text-navy-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                          }
                        `}
                      >
                        <span
                          className={`
                            text-base transition-transform duration-150
                            ${active ? "" : "opacity-70 group-hover:opacity-100 group-hover:scale-105"}
                          `}
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                        {active && (
                          <span
                            aria-hidden
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-green shadow-[0_0_0_3px_rgba(0,200,150,0.2)]"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="pt-[57px] lg:pl-64">
        {/* Email verification banner */}
        {!emailVerified && (
          <div className="mx-6 mt-6 md:mx-12 md:mt-8 rounded-xl border-l-4 border-yellow-500 bg-yellow-50 p-4 md:p-6 shadow-sm dark:bg-yellow-950/40 dark:border-yellow-500/70 dark:ring-1 dark:ring-yellow-900/40">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-2xl">⚠️</div>
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 dark:text-yellow-200">Email sin verificar</h3>
                <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-300/90">
                  Revisa tu bandeja de entrada para completar la verificación de tu email. Esto es importante para acceder a todas las funciones.
                </p>
                <button
                  onClick={handleResendVerificationEmail}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors dark:bg-yellow-500 dark:text-zinc-950 dark:hover:bg-yellow-400"
                >
                  Reenviar email de verificación
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-10 md:px-12 md:py-14">{children}</div>
      </main>

      {/* El rastreo continúa en n8n aunque el usuario cambie de pantalla. */}
      <PriceTrackerBackgroundStatus />

      {/* Keyboard shortcuts help (press ?) */}
      <ShortcutsOverlay />
    </div>
  );
}
