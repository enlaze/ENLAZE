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

/* ─────────────────────────────────────────────────────────────────────
 *  Curated sidebar — single source of truth.
 *  Labels 100% Spanish. "Centro de control" is always the top entry and
 *  routes to /dashboard (home). Sector visibility is applied on top via
 *  `visibleModules()` from SectorContext.
 * ──────────────────────────────────────────────────────────────────── */

type NavItem = { href: string; label: string; icon: string };
type NavSection = { section: string | null; items: NavItem[] };

const sidebarSections: NavSection[] = [
  {
    section: null,
    items: [{ href: "/dashboard", label: "Centro de control", icon: "🏠" }],
  },
  {
    section: "General",
    items: [
      { href: "/dashboard/clientes", label: "Clientes", icon: "👥" },
      { href: "/dashboard/messages", label: "WhatsApp", icon: "💬" },
      { href: "/dashboard/emails", label: "Emails", icon: "📧" },
    ],
  },
  {
    section: "Negocio",
    items: [
      { href: "/dashboard/budgets", label: "Presupuestos", icon: "📋" },
      { href: "/dashboard/prices", label: "Banco de precios", icon: "💰" },
      { href: "/dashboard/projects", label: "Obras", icon: "🏗️" },
      { href: "/dashboard/suppliers", label: "Proveedores", icon: "🔧" },
      { href: "/dashboard/orders", label: "Pedidos", icon: "📦" },
      { href: "/dashboard/delivery-notes", label: "Albaranes", icon: "📄" },
    ],
  },
  {
    section: "Finanzas",
    items: [
      { href: "/dashboard/suppliers/invoices", label: "Facturas recibidas", icon: "🧾" },
      { href: "/dashboard/issued-invoices", label: "Facturas emitidas", icon: "📑" },
      { href: "/dashboard/margins", label: "Márgenes", icon: "📊" },
    ],
  },
  {
    section: "Sistema",
    items: [
      { href: "/dashboard/calendar", label: "Calendario", icon: "📅" },
      { href: "/dashboard/settings", label: "Ajustes", icon: "⚙️" },
      { href: "/dashboard/compliance", label: "Cumplimiento", icon: "🛡️" },
      { href: "/dashboard/audit-log", label: "Registro de actividad", icon: "📋" },
    ],
  },
];

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
  const router = useRouter();
  const pathname = usePathname();
  const { visibleModules } = useSector();

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
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleResendVerificationEmail = async () => {
    if (!user?.email) return;
    try {
      await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      alert("Email de verificación reenviado. Revisa tu bandeja de entrada.");
    } catch (error) {
      console.error("Error resending email:", error);
      alert("Error al reenviar el email. Intenta de nuevo.");
    }
  };

  const emailVerified = user?.user_metadata?.email_verified === true;

  // Apply sector visibility on top of the curated structure.
  // If sector config returns modules, only show items whose href is in
  // that allow-list. Centro de control / Ajustes / Cumplimiento /
  // Registro de actividad are always shown regardless of sector.
  const sectorModules = visibleModules();
  const sectorHrefs = new Set(sectorModules.map((m) => m.href));
  const alwaysVisible = new Set([
    "/dashboard",
    "/dashboard/settings",
    "/dashboard/compliance",
    "/dashboard/audit-log",
  ]);
  const navSections: NavSection[] = sidebarSections
    .map((sec) => ({
      section: sec.section,
      items: sec.items.filter(
        (it) =>
          alwaysVisible.has(it.href) ||
          sectorHrefs.size === 0 ||
          sectorHrefs.has(it.href)
      ),
    }))
    .filter((sec) => sec.items.length > 0);

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
          {navSections.map((sec, idx) => (
            <div key={sec.section ?? `top-${idx}`} className={idx === 0 ? "" : "mt-5"}>
              {sec.section && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
                  {sec.section}
                </p>
              )}
              <ul className="space-y-0.5">
                {sec.items.map((item) => {
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
                          transition-all duration-150
                          ${
                            active
                              ? "bg-navy-900 text-white shadow-[0_4px_16px_-8px_rgba(10,25,41,0.4)] dark:bg-zinc-900 dark:text-white dark:shadow-none dark:ring-1 dark:ring-zinc-800"
                              : "text-navy-600 hover:bg-navy-50 hover:text-navy-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
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

      {/* Keyboard shortcuts help (press ?) */}
      <ShortcutsOverlay />
    </div>
  );
}
